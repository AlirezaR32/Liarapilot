// Shared domain types for LiaraPilot.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Project profile (spec §6) — validated, evidence-based, unknowns stay unknown
// ---------------------------------------------------------------------------

export const Confidence = z.enum(['high', 'medium', 'low', 'unknown']);

export const Evidence = z.object({
  file: z.string(), // repository path the evidence came from
  field: z.string(), // which profile field this evidence supports
  detail: z.string(), // short human explanation
});

export const EnvVarRequirement = z.object({
  name: z.string(),
  required: z.boolean(),
  source: z.string(), // evidence file (e.g. ".env.example")
  note: z.string().optional(),
});

export const DeploymentCandidate = z.object({
  method: z.enum(['liara_cli_deploy', 'liara_api_sources', 'dockerfile_cli', 'unsupported']),
  platform: z.string().nullable(), // liara platform id, e.g. "node", "docker"
  rationale: z.string(),
  confidence: Confidence,
});

export const ProjectProfile = z.object({
  repository: z.string(), // owner/name
  defaultBranch: z.string().nullable(),
  analyzedSha: z.string().nullable(),
  language: z.string().nullable(),
  languageVersion: z.string().nullable(),
  framework: z.string().nullable(),
  packageManager: z.enum(['npm', 'yarn', 'pnpm', 'bun', 'pip', 'poetry', 'unknown']).nullable(),
  buildCommand: z.string().nullable(),
  startCommand: z.string().nullable(),
  appPort: z.number().nullable(),
  deploymentCandidates: z.array(DeploymentCandidate),
  requiredEnvVars: z.array(EnvVarRequirement),
  configFiles: z.array(z.string()),
  buildRequirements: z.array(z.string()),
  hasDockerfile: z.boolean(),
  hasLiaraManifest: z.boolean(),
  isDeployable: z.boolean(),
  blockers: z.array(z.string()),
  knownLimitations: z.array(z.string()),
  readmeSummary: z.string().nullable(),
  evidence: z.array(Evidence),
  analyzedAt: z.string(),
});

export type ProjectProfile = z.infer<typeof ProjectProfile>;

// ---------------------------------------------------------------------------
// Deployment plan (spec §8)
// ---------------------------------------------------------------------------

export const RiskLevel = z.enum(['low', 'medium', 'high']);

export const DeploymentPlanData = z.object({
  detectedFramework: z.string().nullable(),
  runtime: z.string().nullable(),
  method: z.string(),
  platform: z.string().nullable(),
  buildConfig: z.string().nullable(),
  startConfig: z.string().nullable(),
  requiredEnvVarNames: z.array(z.string()),
  missingEnvVarNames: z.array(z.string()),
  liaraServiceType: z.string().nullable(),
  resourceSuggestion: z
    .object({ planId: z.string().nullable(), rationale: z.string() })
    .nullable(), // only when evidence exists
  costEstimate: z
    .object({ amountUsd: z.number(), basis: z.string(), verified: z.boolean() })
    .nullable(), // only from verified pricing
  blockers: z.array(z.string()),
  expectedEffects: z.array(z.string()),
  risks: z.array(z.string()),
  rollback: z.string(),
  requiresApproval: z.boolean(),
  approvalReasons: z.array(z.string()),
  commitSha: z.string().nullable(),
});

export type DeploymentPlanData = z.infer<typeof DeploymentPlanData>;

// ---------------------------------------------------------------------------
// Risk classification (deterministic policy engine, spec §10)
// ---------------------------------------------------------------------------

export type RiskClassification = {
  actionType: string;
  risk: z.infer<typeof RiskLevel>;
  requiresApproval: boolean;
  reasons: string[];
  reversible: boolean;
};

// ---------------------------------------------------------------------------
// Evidence packages & diagnosis (spec §9)
// ---------------------------------------------------------------------------

export const EvidencePackage = z.object({
  boundedAt: z.string(),
  healthChecks: z.array(
    z.object({
      at: z.string(),
      status: z.string(),
      httpStatus: z.number().nullable(),
      latencyMs: z.number().nullable(),
      error: z.string().nullable(),
    }),
  ),
  serviceStatus: z.string().nullable(),
  recentDeploys: z.array(z.record(z.string(), z.unknown())),
  recentLogs: z.array(z.string()), // redacted, bounded
  recentCommits: z.array(z.string()),
  resourceMetrics: z.string().nullable(),
  configMetadata: z.record(z.string(), z.unknown()),
  notes: z.array(z.string()),
});

export type EvidencePackage = z.infer<typeof EvidencePackage>;

export const Diagnosis = z.object({
  observedFacts: z.array(z.string()),
  probableCauses: z.array(
    z.object({
      cause: z.string(),
      confidence: Confidence,
      supportingEvidence: z.string(),
    }),
  ),
  uncertainty: z.string(),
  recommendedNextSteps: z.array(z.string()),
  potentialImpact: z.string(),
  requiredPermissions: z.array(z.string()),
  proposedRemediation: z
    .object({
      kind: z.enum(['set_env', 'restart_app', 'code_patch', 'rollback', 'none']),
      title: z.string(),
      description: z.string(),
      diff: z.string().nullable(),
      requiresApproval: z.boolean(),
      reversible: z.boolean(),
    })
    .nullable(),
});

export type Diagnosis = z.infer<typeof Diagnosis>;

// ---------------------------------------------------------------------------
// Workflow state (LangGraph state, spec §7)
// ---------------------------------------------------------------------------

export type WorkflowStage =
  | 'queued'
  | 'repository_discovery'
  | 'repository_analysis'
  | 'infrastructure_state'
  | 'assessment'
  | 'action_planning'
  | 'policy_validation'
  | 'awaiting_approval'
  | 'execution'
  | 'post_action_verification'
  | 'reporting'
  | 'completed'
  | 'failed';

export const USER_FACING_STAGES: Record<WorkflowStage, string> = {
  queued: 'Queued',
  repository_discovery: 'Reading repository',
  repository_analysis: 'Analyzing configuration',
  infrastructure_state: 'Checking infrastructure',
  assessment: 'Assessing deployment readiness',
  action_planning: 'Preparing plan',
  policy_validation: 'Validating policy',
  awaiting_approval: 'Waiting for approval',
  execution: 'Executing operation',
  post_action_verification: 'Verifying service health',
  reporting: 'Preparing report',
  completed: 'Completed',
  failed: 'Failed',
};

// Trigger sources (spec §7)
export type TriggerKind =
  | 'repo_connected'
  | 'push_event'
  | 'manual_deploy'
  | 'manual_analyze'
  | 'health_check'
  | 'scheduled'
  | 'incident'
  | 'chat';

// LLM adapter types
export interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}
