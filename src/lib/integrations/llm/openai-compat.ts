// OpenAI-compatible endpoint compatibility layer.
//
// Reasoning-era models (GPT-5 family, o-series) and several OpenAI-compatible
// proxies reject the legacy `max_tokens` parameter — they require
// `max_completion_tokens` — and some also reject any `temperature` other than
// the model default. Rather than asking users to configure this, the request
// "shape" self-adapts: when the server's 400 body names the offending
// parameter, the next attempt uses the corrected shape, and the winning shape
// is cached per endpoint+model so later calls succeed on the first try.
//
// No env, no config — the user's endpoint just works.

export interface OpenAiCompatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface OpenAiChatInput {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAiChatResult {
  ok: boolean;
  status?: number;
  json?: OpenAiChatResponse;
  error?: string;
}

type Shape = { tokenParam: 'max_tokens' | 'max_completion_tokens'; sendTemperature: boolean };

const DEFAULT_SHAPE: Shape = { tokenParam: 'max_tokens', sendTemperature: true };
const shapeCache = new Map<string, Shape>(); // key: baseUrl::model

function shapeKey(cfg: OpenAiCompatConfig): string {
  return `${cfg.baseUrl}::${cfg.model}`;
}

function adaptShape(shape: Shape, errorBody: string): Shape | null {
  const hint = errorBody.toLowerCase();
  let next = shape;
  let changed = false;
  if (
    shape.tokenParam === 'max_tokens' &&
    (hint.includes('max_completion_tokens') ||
      (hint.includes('unsupported parameter') && hint.includes('max_tokens')))
  ) {
    next = { ...next, tokenParam: 'max_completion_tokens' };
    changed = true;
  }
  if (shape.sendTemperature && hint.includes('temperature')) {
    next = { ...next, sendTemperature: false };
    changed = true;
  }
  return changed ? next : null;
}

async function post(
  cfg: OpenAiCompatConfig,
  shape: Shape,
  input: OpenAiChatInput,
): Promise<{ ok: boolean; status: number; text: string; json?: OpenAiChatResponse }> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: input.messages,
    [shape.tokenParam]: input.maxTokens ?? 1500,
  };
  if (shape.sendTemperature) body.temperature = input.temperature ?? 0.3;
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
  });
  const text = await res.text().catch(() => '');
  if (res.ok) {
    try {
      return { ok: true, status: res.status, text, json: JSON.parse(text) as OpenAiChatResponse };
    } catch {
      return { ok: false, status: res.status, text: text.slice(0, 400) || 'invalid JSON response' };
    }
  }
  return { ok: false, status: res.status, text };
}

/** Chat completion against an OpenAI-compatible endpoint, self-adapting shape. */
export async function openAiChat(cfg: OpenAiCompatConfig, input: OpenAiChatInput): Promise<OpenAiChatResult> {
  const key = shapeKey(cfg);
  let shape = shapeCache.get(key) ?? DEFAULT_SHAPE;
  let last: { status: number; text: string } | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await post(cfg, shape, input);
      if (res.ok) {
        shapeCache.set(key, shape); // remember the working shape
        return { ok: true, status: res.status, json: res.json };
      }
      last = { status: res.status, text: res.text };
      // 400/422 → try to self-heal the parameter shape once per hint
      if (res.status === 400 || res.status === 422) {
        const adapted = adaptShape(shape, res.text);
        if (adapted) {
          shape = adapted;
          continue;
        }
      }
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'network error';
      return { ok: false, error: msg.slice(0, 400) };
    }
  }
  return { ok: false, status: last?.status, error: (last?.text ?? 'request failed').slice(0, 400) || 'request failed' };
}

/** Test-only escape hatch: forget cached request shapes. */
export function resetShapeCache(): void {
  shapeCache.clear();
}
