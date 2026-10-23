// POST /api/connections/device/github/start — begin the browser (Device Flow)
// login: returns the user code + verification URL for the user to open.
import { db } from '@/lib/db';
import { json, mapError, resolveUser } from '@/lib/api';
import { randomUUID } from 'crypto';
import { isDeviceProvider, putSession, requestDeviceCode } from '@/lib/integrations/oauth/deviceFlow';
import { audit } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const user = await resolveUser();
    const { provider } = await params;
    if (!isDeviceProvider(provider)) return json({ error: 'unknown provider' }, 404);

    const cfg = await db.appConfig.findUnique({ where: { id: 'app' } });
    const clientId = provider === 'github' ? cfg?.githubClientId : cfg?.gitlabClientId;
    if (!clientId) {
      return json(
        {
          error:
            'برای ورود مرورگری، ابتدا Client ID اپ OAuth باید در «تنظیمات ← ثبت OAuth App» ذخیره شود (یک‌بار برای کل این نصب). تا آن موقع می‌توانید از Personal Access Token استفاده کنید.',
          code: 'no_client_id',
        },
        400,
      );
    }

    const gitlabBase = provider === 'gitlab' ? cfg?.gitlabInstanceUrl ?? 'https://gitlab.com' : 'https://gitlab.com';
    const dc = await requestDeviceCode(provider, clientId, gitlabBase);
    const sessionId = randomUUID();
    putSession({
      id: sessionId,
      provider,
      deviceCode: dc.deviceCode,
      userCode: dc.userCode,
      verificationUri: dc.verificationUri,
      interval: dc.interval,
      expiresAt: Date.now() + dc.expiresIn * 1000,
    });
    await audit(`connection.${provider}.device_start`, { userId: user.id, actor: 'user' });
    return json({
      sessionId,
      userCode: dc.userCode,
      verificationUri: dc.verificationUri,
      interval: dc.interval,
      expiresAt: new Date(Date.now() + dc.expiresIn * 1000).toISOString(),
    });
  } catch (e) {
    return mapError(e);
  }
}
