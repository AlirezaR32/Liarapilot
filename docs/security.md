# Security guide

## Threat model summary

LiaraPilot holds three kinds of power: read access to your repositories, an API/CLI
credential for your Liara account, and an LLM that consumes project-derived content.
The design assumes repository content is **untrusted** (prompt-injection surface) and
that no single failure should lead to an unreviewed production change.

## Human-in-the-loop as a policy boundary

- A deterministic policy engine (`agent/policies.ts`) classifies every action. Reading,
  analyzing, probing, planning, and reporting are automated; creating paid resources,
  deploying, restarting/stopping, env changes, DNS, rollback, repo writes and anything
  unrecognized require approval (fail closed).
- Approvals are records, not UI confirmations: bound to `planHash` (SHA-256 of the
  canonical plan), 30-minute expiry, single-use, **re-validated inside the execution node
  immediately before any command runs**. A materially changed plan invalidates approval.
- Decisions, expiries, executions and verification results are all written to
  `AuditEvent` with actor attribution (`user` vs `agent` vs `system`).

## Prompt-injection defenses

- Repository content is treated as data, never as instructions. READMEs are summarized
  deterministically (excerpt only) and passed to the LLM only inside bounded, redacted
  evidence payloads with a strict system contract (“use only provided evidence”).
- The LLM has **no tool-execution path**: it cannot run commands, deploy, or write. Its
  diagnosis output is schema-validated (zod) and only feeds deterministic remediation
  templates. Proposed shell content can never reach the command builder.
- Repository files containing `liarapilot.skip` abort analysis (repo-owner opt-out).

## Command execution safety

- The only path to the Liara CLI is `buildValidatedCommand()`: whitelisted templates,
  per-argument validators (app-name regex, path rules with `..` rejection, env-key regex,
  credential-reference format), a final metacharacter scan, timeouts, output caps, and no
  shell (argv spawning only).
- Environment variable **values** never appear on a command line; they travel via stdin.
- In demo mode the CLI runner is a deterministic mock; real execution requires
  `LIARA_API_TOKEN` and passes a runtime `--help` flag-verification probe first.

## Secrets handling

- Only **references** (`env:VAR`, `conn:<id>`, `enc:<blob>`) flow through graph state,
  prompts, logs, API responses, and the frontend.
- At-rest secrets use AES-256-GCM (`security/credentials.ts`) keyed by
  `LIARAPILOT_SECRET`; production deployments should move keys into a managed secret
  store (KMS/Secrets Manager) and scope per-connection tokens.
- `redactValue`/`redactString` run before: LLM inputs, workflow events, audit records,
  approval payloads, and API responses containing evidence. Patterns cover PEM keys,
  JWTs, cloud keys, GitHub/Slack tokens, and credentialed connection strings.
- Environment variables are extracted **by name only** from `.env.example`; values are
  dropped at parse time.

## Tenancy & webhooks

- Every project-scoped query goes through `requireProject(id, userId)`; workflow runs,
  incidents, approvals and events are checked against the session user before any data
  is returned.
- GitHub webhooks verify `X-Hub-Signature-256` (HMAC-SHA256, timing-safe compare) and
  fail closed when `GITHUB_WEBHOOK_SECRET` is unset; delivery IDs are deduplicated.
- Sessions are opaque random tokens in httpOnly SameSite cookies; the MVP auto-provisions
  a single demo workspace user. For multi-user production: plug a real IdP into
  `resolveUser()` and keep the same tenant-scoping seams.

## Known limitations (honest list)

- Single-user demo auth; no rate limiting on API routes yet.
- SQLite + in-process worker: single-writer; scale-out requires Postgres + a separate worker.
- The monitoring scheduler lives in the Next.js process — restarting the app pauses checks
  (durable state makes recovery safe, but it is not 24/7 hosting; see operations.md).
- No automatic rollback execution yet (rollback requires a fresh approval and redeploys
  the previous revision).
