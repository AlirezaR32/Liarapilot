// GitHub / GitLab OAuth 2.0 Device Authorization Grant ("browser login").
// The user never pastes a token for this path: the app shows a user code,
// the user opens github.com/login/device (or the GitLab equivalent) in their
// browser, enters the code, and this module polls until GitHub/GitLab issues
// an access token. Requires the deployment's OAuth App client ID — configured
// once in Settings → OAuth App (stored in DB, never in env).
//
// Docs: docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
//       docs.gitlab.com/ee/api/oauth2.html#device-authorization-grant

export type DeviceProvider = 'github' | 'gitlab';

export interface DeviceSession {
  id: string;
  provider: DeviceProvider;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresAt: number;
}

// In-memory device sessions: short-lived (≤15 min), single-container scope.
const sessions = new Map<string, DeviceSession>();

export function putSession(s: DeviceSession): void {
  sessions.set(s.id, s);
  // opportunistic cleanup
  for (const [k, v] of sessions) if (v.expiresAt < Date.now()) sessions.delete(k);
}

export function getSession(id: string): DeviceSession | undefined {
  const s = sessions.get(id);
  if (s && s.expiresAt < Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  return s;
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}

export function isDeviceProvider(v: unknown): v is DeviceProvider {
  return v === 'github' || v === 'gitlab';
}

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** Step 1 — request device + user codes from the provider. */
export async function requestDeviceCode(provider: DeviceProvider, clientId: string, gitlabBase = 'https://gitlab.com'): Promise<DeviceCodeResponse> {
  if (provider === 'github') {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, scope: 'repo read:user' }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !j.device_code || !j.user_code) {
      const err = String(j.error ?? j.message ?? res.status);
      throw new Error(err === 'device_flow_disabled' ? 'Device Flow برای این OAuth App فعال نیست' : `GitHub device-code error: ${err}`);
    }
    return {
      deviceCode: String(j.device_code),
      userCode: String(j.user_code),
      verificationUri: String(j.verification_uri ?? 'https://github.com/login/device'),
      expiresIn: Number(j.expires_in ?? 900),
      interval: Number(j.interval ?? 5),
    };
  }

  const base = gitlabBase.replace(/\/+$/, '');
  const res = await fetch(`${base}/oauth/device/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'read_api' }),
    signal: AbortSignal.timeout(12_000),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !j.device_code || !j.user_code) {
    throw new Error(`GitLab device-code error: ${String(j.error ?? j.message ?? res.status)}`);
  }
  return {
    deviceCode: String(j.device_code),
    userCode: String(j.user_code),
    verificationUri: String(j.verification_uri ?? `${base}/oauth/device`),
    expiresIn: Number(j.expires_in ?? 600),
    interval: Number(j.interval ?? 10),
  };
}

export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'done'; accessToken: string };

/** Step 3 — poll the token endpoint once. */
export async function pollDeviceToken(
  provider: DeviceProvider,
  deviceCode: string,
  clientId: string,
  clientSecret: string | null,
  gitlabBase = 'https://gitlab.com',
): Promise<DevicePollResult> {
  const url = provider === 'github' ? 'https://github.com/login/oauth/access_token' : `${gitlabBase.replace(/\/+$/, '')}/oauth/token`;
  const body: Record<string, string> = {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  };
  if (clientSecret) body.client_secret = clientSecret;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (j.access_token) return { status: 'done', accessToken: String(j.access_token) };
  const err = String(j.error ?? j.error_description ?? '');
  if (err === 'authorization_pending') return { status: 'pending' };
  if (err === 'slow_down') return { status: 'slow_down', interval: 5 };
  if (err === 'access_denied') return { status: 'denied' };
  if (err === 'expired_token' || err === 'code_expired') return { status: 'expired' };
  return { status: 'expired' };
}
