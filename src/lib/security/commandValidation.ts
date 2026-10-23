// Command validation & execution templates (spec §8: "Never execute arbitrary
// shell commands generated directly by an LLM").
//
// Every infrastructure operation goes through a whitelisted command TEMPLATE.
// The LLM may only choose a template + provide arguments; arguments are
// strictly validated (allow-list charset, positional rules) before the final
// command line is assembled. Execution is time-boxed and output-capped.

export type CommandTemplateId =
  | 'liara_deploy'
  | 'liara_app_list'
  | 'liara_app_logs'
  | 'liara_app_restart'
  | 'liara_app_start'
  | 'liara_app_stop'
  | 'liara_env_set'
  | 'liara_plan_list';

export interface CommandTemplate {
  id: CommandTemplateId;
  description: string;
  // argv segments; placeholders like {app} {path} are filled from validated args
  argv: string[];
  args: Record<string, ArgSpec>;
  requiresTokenRef: boolean;
  risk: 'read_only' | 'consequential';
}

export interface ArgSpec {
  kind: 'app_name' | 'path' | 'token_ref' | 'env_key' | 'env_value' | 'number';
  required: boolean;
  maxLen: number;
}

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const PATH_RE = /^[a-zA-Z0-9._\-/]{1,200}$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,80}$/;
const NUMBER_RE = /^\d{1,6}$/;

// token_ref is a REFERENCE (e.g. "conn:<id>" or "env:VAR"), never a secret value
const TOKEN_REF_RE = /^(conn:[A-Za-z0-9_-]{1,60}|env:[A-Z_][A-Z0-9_]{0,50})$/;

function validateArg(spec: ArgSpec, value: string): { ok: true; value: string } | { ok: false; error: string } {
  if (value.length > spec.maxLen) return { ok: false, error: `argument too long (max ${spec.maxLen})` };
  switch (spec.kind) {
    case 'app_name':
      if (!APP_NAME_RE.test(value)) return { ok: false, error: `invalid app name: ${JSON.stringify(value)}` };
      return { ok: true, value };
    case 'path':
      if (!PATH_RE.test(value) || value.includes('..')) return { ok: false, error: `invalid path: ${JSON.stringify(value)}` };
      return { ok: true, value };
    case 'token_ref':
      if (!TOKEN_REF_RE.test(value)) return { ok: false, error: 'invalid credential reference' };
      return { ok: true, value };
    case 'env_key':
      if (!ENV_KEY_RE.test(value)) return { ok: false, error: `invalid env var name: ${JSON.stringify(value)}` };
      return { ok: true, value };
    case 'env_value':
      // no newlines, no NUL, bounded — value never included in command line (goes via stdin)
      if (/[\n\r\0]/.test(value)) return { ok: false, error: 'invalid env value: control characters' };
      if (value.length > 4000) return { ok: false, error: 'env value too long' };
      return { ok: true, value };
    case 'number':
      if (!NUMBER_RE.test(value)) return { ok: false, error: `invalid number: ${JSON.stringify(value)}` };
      return { ok: true, value };
  }
}

export const COMMAND_TEMPLATES: Record<CommandTemplateId, CommandTemplate> = {
  liara_deploy: {
    id: 'liara_deploy',
    description: 'Deploy a prepared project directory to a Liara app via the official CLI.',
    // NOTE: no --detach — the CLI streams build output and exits when the
    // release is ready, so completion means "deployed", not "queued".
    argv: ['liara', 'deploy', '--app', '{app}', '--path', '{path}', '--api-token', '{token_ref}'],
    args: {
      app: { kind: 'app_name', required: true, maxLen: 42 },
      path: { kind: 'path', required: true, maxLen: 200 },
      token_ref: { kind: 'token_ref', required: true, maxLen: 80 },
    },
    requiresTokenRef: true,
    risk: 'consequential',
  },
  liara_app_list: {
    id: 'liara_app_list',
    description: 'List Liara apps.',
    argv: ['liara', 'app', 'list', '--api-token', '{token_ref}', '--output', 'json'],
    args: { token_ref: { kind: 'token_ref', required: true, maxLen: 80 } },
    requiresTokenRef: true,
    risk: 'read_only',
  },
  liara_app_logs: {
    id: 'liara_app_logs',
    description: 'Fetch bounded recent logs of a Liara app.',
    argv: ['liara', 'app', 'logs', '--app', '{app}', '--since', '1', 'hours', 'ago', '--api-token', '{token_ref}'],
    args: {
      app: { kind: 'app_name', required: true, maxLen: 42 },
      token_ref: { kind: 'token_ref', required: true, maxLen: 80 },
    },
    requiresTokenRef: true,
    risk: 'read_only',
  },
  liara_app_restart: {
    id: 'liara_app_restart',
    description: 'Restart a Liara app (approval required by policy).',
    argv: ['liara', 'app', 'restart', '--app', '{app}', '--api-token', '{token_ref}'],
    args: {
      app: { kind: 'app_name', required: true, maxLen: 42 },
      token_ref: { kind: 'token_ref', required: true, maxLen: 80 },
    },
    requiresTokenRef: true,
    risk: 'consequential',
  },
  liara_app_start: {
    id: 'liara_app_start',
    description: 'Start a stopped Liara app (approval required by policy).',
    argv: ['liara', 'app', 'start', '--app', '{app}', '--api-token', '{token_ref}'],
    args: {
      app: { kind: 'app_name', required: true, maxLen: 42 },
      token_ref: { kind: 'token_ref', required: true, maxLen: 80 },
    },
    requiresTokenRef: true,
    risk: 'consequential',
  },
  liara_app_stop: {
    id: 'liara_app_stop',
    description: 'Stop a Liara app (approval required by policy; production impact).',
    argv: ['liara', 'app', 'stop', '--app', '{app}', '--api-token', '{token_ref}'],
    args: {
      app: { kind: 'app_name', required: true, maxLen: 42 },
      token_ref: { kind: 'token_ref', required: true, maxLen: 80 },
    },
    requiresTokenRef: true,
    risk: 'consequential',
  },
  liara_env_set: {
    id: 'liara_env_set',
    description: 'Set an environment variable on a Liara app (approval required by policy).',
    argv: ['liara', 'env', 'set', '{env_key}', '--app', '{app}', '--api-token', '{token_ref}'],
    args: {
      env_key: { kind: 'env_key', required: true, maxLen: 81 },
      app: { kind: 'app_name', required: true, maxLen: 42 },
      token_ref: { kind: 'token_ref', required: true, maxLen: 80 },
    },
    requiresTokenRef: true,
    risk: 'consequential',
  },
  liara_plan_list: {
    id: 'liara_plan_list',
    description: 'List Liara resource plans (read-only).',
    argv: ['liara', 'plan', 'list', '--api-token', '{token_ref}', '--output', 'json'],
    args: { token_ref: { kind: 'token_ref', required: true, maxLen: 80 } },
    requiresTokenRef: true,
    risk: 'read_only',
  },
};

export interface ValidatedCommand {
  templateId: CommandTemplateId;
  argv: string[];
  stdin?: { envKey: string; envValue: string }; // for env_set — value NOT on the command line
}

export class CommandValidationError extends Error {}

/**
 * Build a validated command from a template + raw args.
 * Throws CommandValidationError on any deviation. This is the ONLY way
 * infrastructure commands are produced in LiaraPilot.
 */
export function buildValidatedCommand(
  templateId: CommandTemplateId,
  rawArgs: Record<string, string>,
  envValue?: string,
): ValidatedCommand {
  const template = COMMAND_TEMPLATES[templateId];
  if (!template) throw new CommandValidationError(`unknown command template: ${templateId}`);

  const filled: Record<string, string> = {};
  for (const [key, spec] of Object.entries(template.args)) {
    const raw = rawArgs[key];
    if (raw === undefined || raw === null || raw === '') {
      if (spec.required) throw new CommandValidationError(`missing required argument: ${key}`);
      filled[key] = '';
      continue;
    }
    const res = validateArg(spec, String(raw));
    if (!res.ok) throw new CommandValidationError(res.error);
    filled[key] = res.value;
  }

  const argv = template.argv.map((seg) => {
    const m = /^\{(\w+)\}$/.exec(seg);
    return m ? filled[m[1]] ?? '' : seg;
  });

  // hard final check: no shell metacharacters anywhere in argv
  for (const seg of argv) {
    if (/[;&|`$><\\\n\0'"]/.test(seg)) {
      throw new CommandValidationError(`forbidden character in command argument: ${JSON.stringify(seg)}`);
    }
  }

  let stdin: ValidatedCommand['stdin'];
  if (templateId === 'liara_env_set' && envValue !== undefined) {
    const v = validateArg({ kind: 'env_value', required: true, maxLen: 4000 }, envValue);
    if (!v.ok) throw new CommandValidationError(v.error);
    stdin = { envKey: filled.env_key, envValue: v.value };
  }

  return { templateId, argv, stdin };
}

/** Whether the template performs a consequential (approval-gated) operation. */
export function isConsequential(templateId: CommandTemplateId): boolean {
  return COMMAND_TEMPLATES[templateId]?.risk === 'consequential';
}
