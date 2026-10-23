// Typed LangGraph state + workflow event emission (progress visibility, spec §11).
import { Annotation } from '@langchain/langgraph';
import { db } from '@/lib/db';
import type { ProjectProfile, DeploymentPlanData, RiskClassification, EvidencePackage, Diagnosis } from '@/lib/types';

export const DeployState = Annotation.Root({
  projectId: Annotation<string>,
  userId: Annotation<string>,
  runId: Annotation<string>,
  threadId: Annotation<string>,
  trigger: Annotation<string>,

  // discovery
  repoMeta: Annotation<{ fullName: string; defaultBranch: string; description: string | null; pushedAt: string | null } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  commitSha: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // analysis
  profile: Annotation<ProjectProfile | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  profileFromCache: Annotation<boolean>({
    reducer: (_a, b) => b,
    default: () => false,
  }),

  // infrastructure evidence
  infraState: Annotation<{ apps: Array<{ name: string; status?: string; platform?: string; isDeployed?: boolean }>; source: 'api' | 'not_connected' | 'unavailable'; checkedAt: string } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // assessment
  assessmentResult: Annotation<{ deployed: boolean; drift: boolean; ready: boolean; notes: string[] } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // planning
  plan: Annotation<DeploymentPlanData | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  planId: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  planHash: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  risk: Annotation<RiskClassification | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  approvalId: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  approvalDecision: Annotation<{ approved: boolean; decidedBy: string; note?: string } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // execution & verification
  executionResult: Annotation<{ ok: boolean; method: string; exitCode: number | null; mode: 'real' | 'not_connected'; release?: string; appUrl?: string; logs: string[]; stage?: string } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  verification: Annotation<{ ok: boolean; method: string; details: string[]; at: string } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // final
  report: Annotation<{ headline: string; detail: string; nextSteps: string[]; outcome: 'success' | 'failure' | 'awaiting_user' | 'rejected' } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  error: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
});

export type DeployStateType = typeof DeployState.State;

// ---------------------------------------------------------------------------
// Incident investigation state
// ---------------------------------------------------------------------------

export const InvestigateState = Annotation.Root({
  projectId: Annotation<string>,
  userId: Annotation<string>,
  runId: Annotation<string>,
  threadId: Annotation<string>,
  incidentId: Annotation<string>,

  evidence: Annotation<EvidencePackage | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  diagnosis: Annotation<Diagnosis | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  diagnosisSource: Annotation<'llm' | 'rules'>({
    reducer: (_a, b) => b,
    default: () => 'rules',
  }),
  approvalId: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  approvalDecision: Annotation<{ approved: boolean; decidedBy: string; note?: string } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  remediationResult: Annotation<{ applied: boolean; kind: string; detail: string } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  verification: Annotation<{ resolved: boolean; details: string[]; at: string } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  report: Annotation<{ headline: string; detail: string; nextSteps: string[] } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  error: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
});

export type InvestigateStateType = typeof InvestigateState.State;

// ---------------------------------------------------------------------------
// Event emission — real progress only; no invented percentages (spec §11)
// ---------------------------------------------------------------------------

export async function emitEvent(
  runId: string,
  node: string,
  message: string,
  level: 'info' | 'warn' | 'error' | 'success' = 'info',
  data?: Record<string, unknown>,
): Promise<void> {
  await db.workflowEvent.create({
    data: {
      runId,
      node,
      level,
      message: message.slice(0, 2000),
      dataJson: data ? JSON.stringify(data) : null,
    },
  });
}

export async function setRunStage(runId: string, stage: string, status?: string): Promise<void> {
  await db.workflowRun.update({
    where: { id: runId },
    data: { stage, ...(status ? { status } : {}) },
  });
}
