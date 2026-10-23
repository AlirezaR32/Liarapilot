// GET    /api/settings/ai — THIS workspace's AI connection status (masked).
// PUT    /api/settings/ai { apiKey, baseUrl?, model? } — validate with a tiny
//        live chat/completions probe, then store AES-256-GCM encrypted.
// DELETE /api/settings/ai — disconnect the AI brain.
// Commercial model: the AI key belongs to the user and is entered in the UI —
// never an environment variable.
import { db } from '@/lib/db';
import { json, mapError, readJson, resolveUser } from '@/lib/api';
import { makeEncryptedRef, maskSecret, resolveTokenRef } from '@/lib/security/credentials';
import { openAiChat } from '@/lib/integrations/llm/openai-compat';
import { audit } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

async function probeEndpoint(baseUrl: string, model: string, apiKey: string): Promise<{ ok: boolean; error?: string }> {
  // maxTokens 64: reasoning-style models (GPT-5 family, o-series) reject tiny
  // budgets; openai-compat self-adapts max_completion_tokens / temperature.
  const res = await openAiChat(
    { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model },
    { messages: [{ role: 'user', content: 'ping' }], maxTokens: 64, timeoutMs: 20_000 },
  );
  if (res.ok) return { ok: true };
  return { ok: false, error: `${res.status ?? ''}: ${(res.error ?? 'network error').slice(0, 200)}`.trim() };
}

function normalizeBase(raw?: string): string {
  const url = (raw && raw.trim()) || 'https://api.openai.com/v1';
  return /^https?:\/\//.test(url) ? url.replace(/\/+$/, '') : `https://${url.replace(/\/+$/, '')}`;
}

export async function GET() {
  try {
    const user = await resolveUser();
    const ai = await db.aiConnection.findUnique({ where: { userId: user.id } });
    if (!ai) return json({ connected: false });
    const key = resolveTokenRef(ai.apiKeyRef);
    return json({
      connected: Boolean(key),
      provider: ai.provider,
      model: ai.model,
      baseUrl: ai.baseUrl,
      keyMask: key ? maskSecret(key) : null,
      verified: ai.verified,
      connectedAt: ai.createdAt,
    });
  } catch (e) {
    return mapError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const user = await resolveUser();
    const body = await readJson<{ apiKey?: string; baseUrl?: string; model?: string; test?: boolean }>(req);
    const apiKey = (body.apiKey ?? '').trim();

    const existing = await db.aiConnection.findUnique({ where: { userId: user.id } });
    const storedKey = existing ? resolveTokenRef(existing.apiKeyRef) : null;
    const effectiveKey = apiKey || storedKey;
    if (!effectiveKey) return json({ error: 'کلید API هوش مصنوعی لازم است' }, 400);

    const baseUrl = normalizeBase(body.baseUrl ?? existing?.baseUrl);
    const model = (body.model ?? existing?.model ?? 'gpt-4o-mini').trim().slice(0, 120);

    if (body.test !== false) {
      const probe = await probeEndpoint(baseUrl, model, effectiveKey);
      if (!probe.ok) {
        return json({ error: `اتصال به سرویس هوش مصنوعی ناموفق بود (${probe.error}) — آدرس/کلید/مدل را بررسی کنید. برای ذخیره بدون آزمایش، «test» را false بفرستید.` }, 400);
      }
    }

    await db.aiConnection.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        provider: 'openai',
        baseUrl,
        model,
        apiKeyRef: makeEncryptedRef(effectiveKey),
        verified: true,
        verifiedAt: new Date(),
      },
      update: {
        baseUrl,
        model,
        ...(apiKey ? { apiKeyRef: makeEncryptedRef(apiKey) } : {}),
        verified: true,
        verifiedAt: new Date(),
      },
    });
    await audit('connection.ai.saved', { userId: user.id, actor: 'user', detail: { baseUrl, model } });
    return json({ ok: true, model, baseUrl });
  } catch (e) {
    return mapError(e);
  }
}

export async function DELETE() {
  try {
    const user = await resolveUser();
    await db.aiConnection.deleteMany({ where: { userId: user.id } });
    await audit('connection.ai.disconnect', { userId: user.id, actor: 'user' });
    return json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
