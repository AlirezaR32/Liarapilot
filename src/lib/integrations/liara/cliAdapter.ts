// Liara CLI adapter (spec §4, §8): uses the official @liara/cli for workflows
// where it is the supported path (deploying a prepared project directory).
//
// Design constraints:
//  - Commands are ONLY produced by buildValidatedCommand() (whitelisted
//    templates + strict argument validation). The agent cannot inject shell.
//  - Real execution requires the `liara` binary AND the workspace's own Liara
//    API token (entered by the user in Settings). The token VALUE is resolved
//    at the last possible moment and substituted into argv just before spawn;
//    command previews always mask it. Without a connection, the adapter fails
//    fast with a clear, actionable error — no silent simulation.
//  - `liara deploy --help` is probed at runtime before executing (registry:
//    deploy flags = verify-at-runtime).

import { buildValidatedCommand, CommandValidationError, type CommandTemplateId, type ValidatedCommand } from '@/lib/security/commandValidation';

export interface CliRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  mode: 'real' | 'not_connected';
  commandPreview: string; // argv joined, WITHOUT any secret-bearing segment
}

export interface CliRunner {
  run(cmd: ValidatedCommand, opts: { timeoutMs: number; outputCap: number; context: CliRunContext; tokenValue?: string; onOutput?: (chunk: string) => void }): Promise<CliRunResult>;
}

export interface CliRunContext {
  appName: string;
  projectPath: string;
  envKey?: string;
  envValue?: string;
}

export function safeCommandPreview(cmd: ValidatedCommand): string {
  return cmd.argv
    .map((seg) => (/^(conn:|enc:|env:)/.test(seg) ? '<cred-ref>' : seg))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Real runner — child_process with timeouts, output caps, no shell.
// The validated argv carries a `conn:<userId>` credential REFERENCE; the real
// token VALUE (resolved from the encrypted store by the caller) is substituted
// into the `--api-token` slot at spawn time and never appears in previews,
// logs, or persisted results.
// ---------------------------------------------------------------------------

const TOKEN_REF_RE = /^conn:[A-Za-z0-9_-]{1,60}$/;

function injectToken(argv: string[], tokenValue: string): string[] {
  return argv.map((seg) => (TOKEN_REF_RE.test(seg) ? tokenValue : seg));
}

const REAL: CliRunner = {
  async run(cmd, opts) {
    const { spawn } = await import('child_process');
    const token = opts.tokenValue;
    if (!token) {
      return {
        ok: false,
        exitCode: null,
        stdout: '',
        stderr:
          '[liarapilot] اتصال لیارا برقرار نیست — توکن API لیارا را در «تنظیمات ← اتصال لیارا» وارد کنید (اجرای واقعی بدون توکن انجام نمی‌شود).',
        timedOut: false,
        mode: 'not_connected',
        commandPreview: safeCommandPreview(cmd),
      };
    }
    const argv = injectToken(cmd.argv, token);
    return new Promise<CliRunResult>((resolve) => {
      const preview = safeCommandPreview(cmd);
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const child = spawn(argv[0], argv.slice(1), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LIARAPILOT_EXEC: '1' },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeoutMs);

      const cap = (s: string, existing: string) =>
        existing.length < opts.outputCap ? existing + s.slice(0, Math.max(0, opts.outputCap - existing.length)) : existing;

      child.stdout?.on('data', (d: Buffer) => {
        const s = d.toString('utf8');
        stdout = cap(s, stdout);
        try {
          opts.onOutput?.(s);
        } catch {
          /* stream consumers must never break execution */
        }
      });
      child.stderr?.on('data', (d: Buffer) => {
        const s = d.toString('utf8');
        stderr = cap(s, stderr);
        try {
          opts.onOutput?.(s);
        } catch {
          /* idem */
        }
      });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, exitCode: null, stdout, stderr: `${stderr}\n${err.message}`, timedOut, mode: 'real', commandPreview: preview });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: !timedOut && code === 0,
          exitCode: code,
          stdout,
          stderr: timedOut ? `${stderr}\n[liarapilot] process timed out after ${opts.timeoutMs}ms` : stderr,
          timedOut,
          mode: 'real',
          commandPreview: preview,
        });
      });

      if (cmd.stdin) {
        child.stdin?.write(`${cmd.stdin.envKey}=${cmd.stdin.envValue}\n`);
        child.stdin?.end();
      } else {
        child.stdin?.end();
      }
    });
  },
};

// ---------------------------------------------------------------------------
// Adapter facade
// ---------------------------------------------------------------------------

export interface RunCommandOptions {
  templateId: CommandTemplateId;
  args: Record<string, string>;
  envValue?: string;
  context: CliRunContext;
  timeoutMs?: number;
  outputCap?: number;
  /** Resolved (plaintext) Liara API token for THIS execution — from the user's encrypted connection. Never logged. */
  tokenValue?: string;
  /** Streaming output sink (live build logs) — optional. */
  onOutput?: (chunk: string) => void;
}

export async function runLiaraCommand(opts: RunCommandOptions): Promise<CliRunResult & { validationError?: string }> {
  let cmd: ValidatedCommand;
  try {
    cmd = buildValidatedCommand(opts.templateId, opts.args, opts.envValue);
  } catch (e) {
    if (e instanceof CommandValidationError) {
      return {
        ok: false,
        exitCode: null,
        stdout: '',
        stderr: `command validation failed: ${e.message}`,
        timedOut: false,
        mode: 'real',
        commandPreview: '<rejected>',
        validationError: e.message,
      };
    }
    throw e;
  }

  const timeoutMs = opts.timeoutMs ?? 120_000;
  const outputCap = opts.outputCap ?? 20_000;

  // Verify `liara deploy` flag support before executing (capability registry:
  // unverified flags are never run).
  if (opts.templateId === 'liara_deploy') {
    const probe = await REAL.run(
      { templateId: 'liara_deploy', argv: ['liara', 'deploy', '--help'], stdin: undefined },
      { timeoutMs: 10_000, outputCap: 10_000, context: opts.context, tokenValue: opts.tokenValue },
    );
    if (!probe.ok || !/--path/.test(`${probe.stdout}${probe.stderr}`)) {
      return {
        ok: false,
        exitCode: null,
        stdout: probe.stdout,
        stderr:
          probe.mode === 'not_connected'
            ? probe.stderr
            : '[liarapilot] Runtime verification of `liara deploy --path` failed. Per the capability registry, unverified flags are never executed. Install/upgrade @liara/cli or deploy manually.',
        timedOut: false,
        mode: probe.mode,
        commandPreview: probe.commandPreview,
      };
    }
  }

  return REAL.run(cmd, { timeoutMs, outputCap, context: opts.context, tokenValue: opts.tokenValue, onOutput: opts.onOutput });
}
