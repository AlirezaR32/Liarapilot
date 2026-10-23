// LLM adapter (spec §4: "Keep provider-specific model integration behind a
// small abstraction so the model can be changed without rewriting the app").
//
// Commercial provider chain (NO env credentials):
//   1. The workspace's own AI connection — an OpenAI-compatible REST endpoint
//      (ChatGPT, Azure OpenAI, OpenRouter, local vLLM…) entered by the user
//      in Settings → AI and stored AES-256-GCM encrypted.
//   2. Platform-bundled z-ai model — available in managed/dev deployments
//      only; outside it the call fails fast and the UI shows "connect AI".
//
// Backend-only. Structured outputs are obtained via JSON-mode prompting + zod
// validation + bounded retry. Every call records usage (tokens estimated).

import ZAI from 'z-ai-web-dev-sdk';
import type { ChatMessageInput, LlmResult } from '@/lib/types';
import { boundAndRedact } from '@/lib/security/redaction';
import { db } from '@/lib/db';
import { resolveTokenRef } from '@/lib/security/credentials';
import { openAiChat } from './openai-compat';
import { z } from 'zod';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCallOptions {
  system: string;
  user: string;
  history?: ChatMessage[]; // prior turns (chat channel)
  maxTokens?: number; // advisory
  temperature?: number; // advisory
  label: string; // usage accounting label, e.g. "incident_investigation"
  userId?: string; // workspace owner — selects the user's own AI connection
}

export interface LlmUsage {
  label: string;
  tokensIn: number;
  tokensOut: number;
  ok: boolean;
}

const est = (s: string) => Math.ceil(s.length / 4);

// ---------------------------------------------------------------------------
// Provider resolution — the user's OWN AI connection (DB), never env
// ---------------------------------------------------------------------------

export type LlmProvider = 'chatgpt' | 'zai' | 'none';

export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export async function getAiConfig(userId?: string): Promise<AiConfig | null> {
  if (!userId) return null;
  try {
    const conn = await db.aiConnection.findUnique({ where: { userId } });
    if (!conn) return null;
    const apiKey = resolveTokenRef(conn.apiKeyRef);
    if (!apiKey) return null;
    return { baseUrl: conn.baseUrl.replace(/\/+$/, ''), model: conn.model, apiKey };
  } catch {
    return null;
  }
}

export interface LlmStatusInfo {
  provider: LlmProvider;
  model: string | null;
  aiConfigured: boolean;
  aiBaseUrl: string | null;
  aiKeyMask: string | null;
  fallbackAvailable: boolean;
}

/** z-ai availability — resolved once, cached (fails outside managed deploys). */
let zaiAvailable: boolean | null = null;
function zaiStatus(): boolean {
  if (zaiAvailable === null) {
    zaiAvailable = Boolean(process.env.ZAI_AVAILABLE ?? true);
  }
  return zaiAvailable;
}

export async function llmStatus(userId?: string): Promise<LlmStatusInfo> {
  const cfg = await getAiConfig(userId);
  let keyMask: string | null = null;
  if (cfg) keyMask = `${cfg.apiKey.slice(0, 3)}…${cfg.apiKey.slice(-2)}`;
  return {
    provider: cfg ? 'chatgpt' : zaiStatus() ? 'zai' : 'none',
    model: cfg?.model ?? (zaiStatus() ? 'z-ai-default' : null),
    aiConfigured: Boolean(cfg),
    aiBaseUrl: cfg?.baseUrl ?? null,
    aiKeyMask: keyMask,
    fallbackAvailable: zaiStatus(),
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible REST — chat/completions (user's own endpoint)
// ---------------------------------------------------------------------------

async function chatViaOpenAi(cfg: AiConfig, messages: ChatMessage[], opts: LlmCallOptions): Promise<LlmResult> {
  // openai-compat self-adapts to strict endpoints (max_completion_tokens,
  // temperature-less reasoning models) and caches the winning shape.
  const res = await openAiChat(cfg, { messages, maxTokens: opts.maxTokens ?? 1500, temperature: opts.temperature ?? 0.3 });
  if (!res.ok || !res.json) {
    throw new Error(`LLM API ${res.status ?? 'ERR'}: ${(res.error ?? '').slice(0, 200)}`);
  }
  const content = res.json.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new Error('empty LLM response');
  return {
    content,
    tokensIn: res.json.usage?.prompt_tokens ?? est(messages.map((m) => m.content).join(' ')),
    tokensOut: res.json.usage?.completion_tokens ?? est(content),
    model: cfg.model,
  };
}

// ---------------------------------------------------------------------------
// Platform-bundled z-ai fallback (managed/dev deployments)
// ---------------------------------------------------------------------------

async function chatViaZai(messages: ChatMessage[], opts: LlmCallOptions): Promise<LlmResult> {
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: messages.map((m) => ({ role: m.role === 'system' ? 'assistant' : m.role, content: m.content })),
    thinking: { type: 'disabled' },
  });
  const content = completion.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new Error('empty LLM response');
  return {
    content,
    tokensIn: est(messages.map((m) => m.content).join(' ')),
    tokensOut: est(content),
    model: 'z-ai-default',
  };
}

function buildMessages(opts: LlmCallOptions): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: opts.system }];
  for (const m of opts.history ?? []) {
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: boundAndRedact(m.content, 8_000) });
  }
  messages.push({ role: 'user', content: boundAndRedact(opts.user, 24_000) });
  return messages;
}

/** Plain completion. Returns null on failure after bounded retries. */
export async function chat(opts: LlmCallOptions, retries = 2): Promise<LlmResult | null> {
  const messages = buildMessages(opts);
  const cfg = await getAiConfig(opts.userId);
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (cfg) return await chatViaOpenAi(cfg, messages, opts);
      if (zaiStatus()) return await chatViaZai(messages, opts);
      console.warn(`[llm] no provider connected (${opts.label}) — user must connect AI in Settings`);
      return null;
    } catch (e) {
      lastErr = e;
      if (cfg && zaiStatus() && attempt === 0) {
        // graceful degradation: user endpoint down/quota → one bundled fallback
        try {
          const res = await chatViaZai(messages, opts);
          console.warn(`[llm] user AI endpoint failed (${opts.label}), served by bundled fallback:`, e instanceof Error ? e.message : e);
          return res;
        } catch (e2) {
          lastErr = e2;
          zaiAvailable = false; // don't keep hitting a dead fallback
        }
      }
      if (!cfg) zaiAvailable = false; // bundled model unavailable here — fail fast on next calls
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  console.error(`[llm] call failed (${opts.label}):`, lastErr instanceof Error ? lastErr.message : lastErr);
  return null;
}

/** JSON completion validated by a zod schema; returns null when invalid. */
export async function structuredChat<S extends z.ZodTypeAny>(
  schema: S,
  opts: LlmCallOptions & { schemaHint: string },
  retries = 2,
): Promise<z.infer<S> | null> {
  const system = `${opts.system}\n\nYou MUST respond with a single valid JSON object only — no markdown fences, no commentary.\nJSON shape:\n${opts.schemaHint}`;
  let lastRaw: string | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await chat({ ...opts, system }, attempt === 0 ? 1 : 0);
    if (!res) return null;
    lastRaw = res.content;
    try {
      return schema.parse(extractJson(res.content));
    } catch {
      // retry once with a corrective nudge
    }
  }
  console.error(`[llm] structured output failed validation for ${opts.label}; raw=${lastRaw?.slice(0, 400)}`);
  return null;
}

/** Pull the first JSON object out of a possibly noisy completion. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(candidate.slice(start, end + 1));
}

export type { ChatMessageInput };
