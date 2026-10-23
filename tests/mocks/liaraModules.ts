// Test mocks for the Liara boundaries: CLI adapter + REST API client.
// The REAL graph/services run; only the platform edge is simulated.

type CliOpts = { args: Record<string, string>; context?: { appName?: string } };

const state = { failure: false, attempts: 0 };

export function resetCliMock() {
  state.failure = false;
  state.attempts = 0;
}

export function setCliFailure(v: boolean) {
  state.failure = v;
}

export function cliAttempts() {
  return state.attempts;
}

export async function runLiaraCommand(opts: CliOpts) {
  state.attempts += 1;
  if (state.failure) {
    return {
      ok: false,
      exitCode: 1,
      stdout: '=> Building project\n=> Running build command: npm run build',
      stderr: 'error TS2307: Cannot find module "./payment-gateway"\nBuild failed.',
      timedOut: false,
      mode: 'real' as const,
      commandPreview: `liara deploy --app ${opts.args.app} <cred-ref>`,
    };
  }
  return {
    ok: true,
    exitCode: 0,
    stdout: '=> Packaging project directory\n=> Uploading\n=> Building on Liara\n=> Release v12 created\n=> Deployment finished. Your app is available on the assigned domain.',
    stderr: '',
    timedOut: false,
    mode: 'real' as const,
    commandPreview: `liara deploy --app ${opts.args.app} <cred-ref>`,
  };
}

export async function listApps() {
  return [];
}

export async function listReleases() {
  return { currentRelease: 'v12', releases: [{ id: 'r1', state: 'ready', createdAt: new Date().toISOString() }] };
}

export async function getAppLogs() {
  return [];
}

export const NOT_CONNECTED_MESSAGE = 'اتصال لیارا برقرار نیست';
