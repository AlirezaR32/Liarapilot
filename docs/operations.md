# Operations guide

## Running locally

```bash
bun install
cp .env.example .env      # demo mode needs no credentials
bun run db:push
bun run dev               # http://localhost:3000
```

The engine (scheduler + worker) boots automatically with the server via
`src/instrumentation.ts`. Watch `dev.log` for `[liarapilot] engine started`.

## Modes

| Mode | Trigger | Behavior |
|---|---|---|
| **demo** (default) | no `LIARA_API_TOKEN` | GitHub analysis uses the labeled fixture repo; Liara ops run through the deterministic mock runner; health checks probe the bundled simulated app. Everything is exercisable; nothing touches real infrastructure. |
| **real** | `GITHUB_TOKEN` set | analysis reads real repositories with targeted, bounded requests. |
| **real** | `LIARA_API_TOKEN` set | infrastructure state, logs, releases use the verified API; deploys go through the real CLI after a runtime flag-verification probe. |

You can mix: real GitHub + demo Liara is a useful staging posture.

## Monitoring policies

Per-project policy (`low_cost` / `balanced` / `fast`) controls:

- check interval (300 s / 60 s / 30 s),
- consecutive-failure threshold for opening an incident (4 / 3 / 2),
- cooldown windows and daily LLM investigation budget (5 / 10 / 20).

Trade-off (stated in the UI too): slower policies cost less but detect incidents later
and may miss short-lived ones. There is **no 24/7 promise** unless you deploy the app on
always-on hosting; the scheduler runs inside the Next.js process.

## Scheduled jobs (in-process)

| Job | Cadence | Purpose |
|---|---|---|
| `monitor_sweep` | every 15 s (deduped) | probe due projects, open incidents, trigger investigations |
| `expire_approvals` | every 5 min | expire stale pending approvals |

The queue is the `Job` table; unclaimed jobs survive restarts. Stale `running` workflows
from a crash are marked failed on boot; their checkpoints remain, so they can be re-driven
manually (approvals keep their own expiry).

## Enabling real integrations

1. `LIARA_API_TOKEN` — from the Liara console. Enables verified API endpoints; the CLI
   adapter will also execute real deploys **after** approval and flag verification.
2. `GITHUB_TOKEN` — fine-grained PAT with read-only contents. Enables real repository
   analysis (private repos included).
3. `GITHUB_WEBHOOK_SECRET` — set it on the GitHub webhook and here; unsigned webhooks are
   rejected. Point the webhook at `https://<your-host>/api/webhooks/github` with `push`
   events. Pushes trigger re-analysis — never an automatic deploy.

## Data retention

- Health checks: last 500 per project (older rows pruned on write).
- Workflow events: kept per run (bounded to 200 per API read).
- Audit events: append-only for the workspace lifetime.
- Usage records: per-kind counters power `/api/usage` (24 h window).

## Demo data

- **Seed** (idempotent): `POST /api/demo/seed {"scenario":"all","drive":true}` — creates the
  three labeled fixture projects, starts the Scenario-A pipeline and drives the Scenario-B
  failure detection + investigation.
- **Reset**: `DELETE /api/demo/seed`.
- The simulated target app lives at `/api/demo/target/<projectId>` and follows the
  project’s `mockFailureMode` (`none`, `http_500`, `timeout`, `build_failure`,
  `start_failure`). Only the target is simulated — the probe/monitor code is the real path.

## Troubleshooting

- **“No Liara API token configured”** — expected in demo mode when something tries the
  real API path; set `LIARA_API_TOKEN` or keep using the labeled mock flows.
- **Workflow stuck in `awaiting_approval`** — it expired after 30 min; request a fresh
  deployment (a new plan + approval is generated; the old one is marked expired/audit).
- **“plan changed since approval”** — the approval was bound to a different plan hash;
  request a new approval. This is intentional tamper protection.
- **Scheduler not probing** — confirm the engine banner in `dev.log` and that the project
  has `monitorEnabled` and a reachable target URL.
