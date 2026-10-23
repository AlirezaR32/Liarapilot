# Architecture

## 1. Overview

LiaraPilot is an agent-first DevOps assistant: after a repository is connected, analysis
starts automatically, the agent builds an evidence-based deployment plan, and every
consequential operation pauses at a durable approval gate. A lightweight monitor keeps
watching services with plain code; the LLM is only paged in for genuine incidents, under
budget. Everything is persisted; nothing important is untraceable.

## 2. Module boundaries

```
src/
  lib/
    types.ts                    shared validated schemas (ProjectProfile, plans, evidence…)
    agent/
      repositoryAnalysis.ts     deterministic repo analyzer (targeted reads → ProjectProfile)
      policies.ts               risk classification, monitoring policies, retry rules
      state.ts                  LangGraph state annotations + workflow event emission
      graph.ts                  deploy pipeline graph (10 nodes, conditional edges)
      investigation.ts          incident investigation graph (7 nodes)
    integrations/
      github/client.ts          REST client (bounded reads) + labeled fixture repo
      liara/capabilities.ts     capability registry (verified / documented / cli-only / unsupported)
      liara/apiClient.ts        ONLY verified endpoints; everything else refuses
      liara/cliAdapter.ts       validated command templates → mock | real runner
      llm/adapter.ts            z-ai SDK wrapper (redaction, JSON+zod, retries, usage)
    services/                   projects, deployments, incidents, approvals, audit, monitoring
    security/                   redaction · commandValidation · credentials · session
    persistence/checkpoints.ts  Prisma LangGraph checkpointer (MemorySaver-port storage model)
    workers/                    queue (DB-backed) · runner · engine (instrumentation bootstrap)
  app/                          Next.js App Router: single workspace page + REST API routes
```

Dependencies point strictly downward: routes → services → integrations/persistence. The
agent layer depends on services and integrations, never on HTTP handlers.

## 3. The deploy pipeline (LangGraph)

```
START → repository_discovery → repository_analysis → infrastructure_state → assessment
      → action_planning → policy_validation → approval_gate
      → (approved) execution → post_action_verification → reporting → END
      → (rejected) reporting → END
```

- `action_planning` persists a `DeploymentPlan` (hash-bound) and creates the
  `ApprovalRequest` (TTL 30 min) when policy requires it.
- `approval_gate` calls LangGraph `interrupt()`; the checkpoint (Prisma) survives restarts.
- The decide API stores the decision, then re-drives the graph with `Command({resume})`.
- `execution` re-validates the approval (status, expiry, **plan-hash equality**,
  not-yet-consumed) immediately before running anything, records a `DeploymentExecution`
  with an idempotency key `deploy:<projectId>:<sha>`, classifies failures, and applies the
  retry policy (deterministic failures are never retried).
- `post_action_verification` runs real HTTP probes (plus the verified releases endpoint in
  real mode) and only then flips `project.deployedSha` and reports success.

## 4. The incident loop (SRE)

- **Layer 1 (code)**: scheduler enqueues a `monitor_sweep` every 15 s; due projects get real
  HTTP probes (`performHttpCheck`), stored with retention (last 500/project).
- **Layer 2 (code)**: consecutive-failure thresholds per policy open incidents with
  dedup (`projectId+detectionKey` unique) and cooldown windows.
- **Layer 3 (LLM, budgeted)**: new incidents trigger an investigation graph: bounded,
  redacted evidence package → structured diagnosis (zod-validated) → remediation proposal.
  Daily per-project investigation budgets (policy-driven) gate LLM usage; a deterministic
  rule-based fallback diagnosis runs when the LLM is unavailable or over budget.
- **Layer 4**: smallest reversible action. Restarts/env changes go through the approval
  gate; code patches are proposal-only diffs in this MVP.
- **Layer 5**: two consecutive healthy probes ⇒ resolved; otherwise escalated with the
  evidence preserved — no automated thrashing.

## 5. Durable state

- `WorkflowRun` + `WorkflowEvent` give every run a user-visible stage timeline and an
  audit-friendly record. The LangGraph checkpoint lives in `AgentCheckpoint`/
  `AgentCheckpointWrite` using the same storage model as MemorySaver (whole-checkpoint
  blobs + keyed writes), which makes resume semantics identical across restarts.
- The queue (`Job` table) is claimed optimistically (SQLite-safe), retried with backoff,
  and re-queued on boot if the process died mid-job.
- Engine bootstrap happens in `src/instrumentation.ts` (`register()`), which also marks
  stale `running` workflows as failed after restart (checkpoints remain for manual re-drive).

## 6. Stack decisions & deviations from the original spec

| Spec suggested | Delivered | Why |
|---|---|---|
| Python + FastAPI + LangGraph (py) | Next.js 16 (TS) + **LangGraph.js** + LangChain core | single-port sandbox; identical graph semantics; typed end-to-end |
| PostgreSQL | SQLite via Prisma (schema avoids PG-incompatible features) | sandbox constraint; swap `datasource` to migrate |
| Separate worker/queue | in-process engine + DB-backed queue | no Redis (spec-consistent); persists across restarts |
| SSE | SSE with polling fallback | robust behind the dev proxy |
| LLM provider w/ tool calling | z-ai SDK behind `llm/adapter.ts` (JSON+zod structured outputs) | platform constraint; adapter isolates the provider |

## 7. Frontend

A single task-oriented workspace (spec §11): overview cards answering “what’s running /
what’s wrong / what’s it doing / does it need me”, an approvals queue with full decision
context, incident views with progressive disclosure (summary first, evidence on demand),
an audit timeline, usage counters, and an optional project-scoped chat. Live progress comes
from real `WorkflowEvent`s over SSE — no fake percentages, no premature success states.
