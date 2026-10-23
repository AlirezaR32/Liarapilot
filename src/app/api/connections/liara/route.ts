// POST   /api/connections/liara  { token } — validate against the Liara API
//        (GET /v1/me) then store AES-256-GCM encrypted for THIS workspace.
// DELETE /api/connections/liara — disconnect.
// The token is created by the user in Liara Console → API Keys.
import { db } from '@/lib/db';
import { json, mapError, readJson, resolveUser } from '@/lib/api';
import { makeEncryptedRef } from '@/lib/security/credentials';
import { callLiaraMe } from '@/lib/integrations/liara/apiClient';
import { audit } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

class TokenInvalidError extends Error {}

export async function POST(req: Request) {
  try {
    const user = await resolveUser();
    const body = await readJson<{ token?: string }>(req);
    const token = (body.token ?? '').trim();
    if (!token || token.length < 16) return json({ error: 'یک توکن API لیارا معتبر لازم است' }, 400);

    let me: Awaited<ReturnType<typeof callLiaraMe>> = null;
    try {
      me = await callLiaraMe(token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'validation failed';
      if (/401|rejected/i.test(msg)) throw new TokenInvalidError('توکن توسط لیارا رد شد (نامعتبر یا منقضی)');
      throw new TokenInvalidError(`اعتبارسنجی توکن لیارا ناموفق بود: ${msg}`);
    }
    if (!me) throw new TokenInvalidError('اعتبارسنجی توکن لیارا ناموفق بود (سرویس پاسخ نداد)');

    await db.liaraConnection.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        tokenRef: makeEncryptedRef(token),
        accountEmail: me.email,
        verified: true,
        verifiedAt: new Date(),
      },
      update: {
        tokenRef: makeEncryptedRef(token),
        accountEmail: me.email,
        verified: true,
        verifiedAt: new Date(),
      },
    });
    await audit('connection.liara.token', { userId: user.id, actor: 'user', detail: { account: me.email ?? 'unknown' } });
    return json({ ok: true, accountEmail: me.email, fullname: me.fullname });
  } catch (e) {
    if (e instanceof TokenInvalidError) return json({ error: e.message }, 400);
    return mapError(e);
  }
}

export async function DELETE() {
  try {
    const user = await resolveUser();
    await db.liaraConnection.deleteMany({ where: { userId: user.id } });
    await audit('connection.liara.disconnect', { userId: user.id, actor: 'user' });
    return json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
