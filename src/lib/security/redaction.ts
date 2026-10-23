// Secret redaction — applied before ANY model prompt, log, audit record or
// API response that includes repository/config-derived content (spec §6, §9).

const SECRET_KEY_PATTERNS: RegExp[] = [
  /(api_?key|apikey|secret|token|password|passwd|pwd|private_?key|access_?key|credential|session_?key|signing_?key|client_?secret|refresh_?token|bearer|smtp_?pass|db_?pass|passphrase)/i,
];

const SECRET_VALUE_PATTERNS: RegExp[] = [
  // PEM private keys
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Generic bearer/JWT-like tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // AWS-style keys
  /\bAKIA[0-9A-Z]{16}\b/g,
  // GitHub tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // postgres/mysql/mongo/redis connection strings with embedded creds
  /\b(postgres|postgresql|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s:@]+:[^\s:@]+@[^\s]+/gi,
];

export const REDACTED = '[REDACTED]';

function looksLikeSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((p) => p.test(key.trim()));
}

function looksLikeSecretValue(value: string): boolean {
  if (value.length < 8) return false;
  return SECRET_VALUE_PATTERNS.some((p) => p.test(value));
}

/** Redact secrets from arbitrary JSON-able structures (mutates nothing). */
export function redactValue<T>(input: T, depth = 0): T {
  if (depth > 12) return input;
  if (typeof input === 'string') {
    return redactString(input) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((v) => redactValue(v, depth + 1)) as unknown as T;
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (typeof v === 'string' && looksLikeSecretKey(k)) {
        out[k] = v ? REDACTED : v; // empty stays empty (e.g. "PASSWORD=")
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out as unknown as T;
  }
  return input;
}

/** Redact secret-looking content inside a plain string. */
export function redactString(text: string): string {
  let out = text;
  for (const p of SECRET_VALUE_PATTERNS) {
    out = out.replace(p, REDACTED);
  }
  // KEY=VALUE / "key": "value" lines with secret-looking keys
  out = out.replace(
    /^(\s*[A-Za-z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?)[A-Za-z0-9_]*\s*[=:]\s*)(\S.*)$/gim,
    (_m, prefix: string) => `${prefix}${REDACTED}`,
  );
  return out;
}

/** Parse an .env-style example file into env var NAMES only (values dropped). */
export function extractEnvVarNames(envFileContent: string): Array<{ name: string; required: boolean }> {
  const names: Array<{ name: string; required: boolean }> = [];
  const seen = new Set<string>();
  for (const rawLine of envFileContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!m) continue;
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    // "required" heuristic: empty value in example usually means "you must fill this"
    const isEmpty = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(#.*)?$/.test(line);
    names.push({ name, required: isEmpty });
  }
  return names;
}

/** Redact + bound a log/error string for storage or model consumption. */
export function boundAndRedact(text: string, maxChars = 4000): string {
  const bounded =
    text.length > maxChars ? `${text.slice(0, maxChars)}…[truncated ${text.length - maxChars} chars]` : text;
  return redactString(bounded);
}
