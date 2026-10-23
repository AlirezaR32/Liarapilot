# Liara capability registry — verified vs unverified

Source of truth: official docs verified 2026-10.

- API reference: https://developers.liara.ir (per-endpoint OpenAPI pages)
- CLI reference: https://github.com/liara-cloud/cli (README, v9.x)
- General docs: https://docs.liara.ir

Rules enforced in code (`src/lib/integrations/liara/capabilities.ts`):

1. Only **verified** endpoints are callable.
2. **documented_unverified** operations are refused with an explanation.
3. **cli_only** operations run through the validated-command CLI adapter; the `deploy`
   flags are additionally verified at runtime via `liara deploy --help` before use.
4. **unsupported** capabilities produce explicit refusals — never fabricated behavior.

## Verified API endpoints (base: `https://api.liara.ir`, Bearer token auth)

| Operation | Method & path | Notes |
|---|---|---|
| List apps | `GET /v1/projects` | returns `projects[]` (`_id`, `project_id`, `type`, `status`, `scale`, `planID`, `isDeployed`) |
| App logs | `GET /v1/projects/{name}/logs?since=…` | array of `{type, datetime, message}`; bounded client-side |
| Turn on/off | `POST /v1/projects/{name}/actions/scale` | body `{scale: 1\|0}`; approval-gated |
| Restart app | `POST /v1/projects/{name}/actions/restart` | approval-gated |
| Releases | `GET /v1/projects/{name}/releases` | `currentRelease`, `releases[]` incl. `state`, `port`, `platform`, `gitInfo` |
| Deploy source archive | `POST /v2/projects/{name}/sources` | multipart `.gz` (field `file`); **not wired yet** — requires archive preparation (roadmap) |

## Verified CLI commands (`@liara/cli` v9.x)

`login`, `account add/list/use/remove`, `app create/delete/list/logs/restart/shell/start/stop/update-port`,
`deploy`, `env set/unset/list`, `disk create`, `db create/list/remove/resize/start/stop/backup …`,
`bucket create/delete/list`, `mail …`, `network create/list`, `plan list`, `vm …`, `zone …`, `init`, `version`.

Notes:
- `liara deploy` deploys a **prepared project directory** (buildpack or Docker). Its exact
  flags were not verifiable from the README; the adapter therefore validates flag support
  at runtime via `liara deploy --help` and refuses to execute unverified flags.
- `liara env set` (CLI-only) is the supported path for environment variables; no verified
  REST equivalent exists in the registry.

## Documented but NOT individually verified (agent will not call)

- `apps.create`, `apps.delete`, `apps.change_plan`, `apps.events`, `apps.applets`
- Reports: CPU / memory / network-receive / network-transmit

## Unsupported (agent refuses explicitly)

- Real-time resource metric streaming — not in the official docs; monitoring never claims CPU/RAM visibility.
- Deploying a raw source tree directly via API — the verified endpoint requires a prepared `.gz`.
- Fetching application logs or deployment events for services the workspace has no connection to.

## Monitoring claims (`/api/capabilities` exposes this)

| Signal | Claimed? | Source |
|---|---|---|
| HTTP availability / latency | ✅ own probes | real code |
| Platform logs | ✅ via verified logs endpoint (real mode only) | `GET /v1/projects/{name}/logs` |
| Release/deploy state | ✅ via verified releases endpoint | `GET /v1/projects/{name}/releases` |
| CPU / memory metrics | ❌ not claimed | reports endpoints unverified in this MVP |
| Deployment event stream | ❌ not claimed | events endpoint unverified in this MVP |
