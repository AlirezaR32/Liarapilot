// Liara capability registry (spec §3, §15).
//
// Every capability below records its verification status. Nothing in this file
// may be added without a source. Sources verified 2026-10 via:
//   - https://developers.liara.ir (official API docs, per-endpoint OpenAPI)
//   - https://github.com/liara-cloud/cli README (v9.x command reference)
//
// VERIFIED               — endpoint path + method confirmed from official docs
// DOCUMENTED_UNVERIFIED  — listed in official docs index; path/schema not yet
//                          individually confirmed -> NOT called by the agent
// CLI_ONLY               — available through @liara/cli, no confirmed API
// UNSUPPORTED            — not available anywhere; agent must refuse politely

export type Verification = 'verified' | 'documented_unverified' | 'cli_only' | 'unsupported';

export interface LiaraCapability {
  id: string;
  name: string;
  verification: Verification;
  source: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path?: string;
  notes: string;
}

export const LIARA_API_BASE = 'https://api.liara.ir';

export const CAPABILITIES: LiaraCapability[] = [
  {
    id: 'apps.list',
    name: 'List apps (projects)',
    verification: 'verified',
    source: 'developers.liara.ir/pass/apps/get-details-of-all-projects.md',
    method: 'GET',
    path: '/v1/projects',
    notes: 'Returns projects[] with _id, project_id, type, status, scale, planID, created_at, isDeployed.',
  },
  {
    id: 'apps.logs',
    name: 'Fetch app logs',
    verification: 'verified',
    source: 'developers.liara.ir/pass/apps/get-logs-of-app.md',
    method: 'GET',
    path: '/v1/projects/{name}/logs?since=...',
    notes: 'Returns array of {type, datetime, message}. `since` required. Bounded retrieval enforced client-side.',
  },
  {
    id: 'apps.scale_on_off',
    name: 'Turn app on/off (scale)',
    verification: 'verified',
    source: 'developers.liara.ir/pass/apps/turn-on-or-off-a-app.md',
    method: 'POST',
    path: '/v1/projects/{name}/actions/scale',
    notes: 'Body {scale: 1|0}. Consequential — approval required.',
  },
  {
    id: 'apps.restart',
    name: 'Restart app',
    verification: 'verified',
    source: 'developers.liara.ir/pass/apps/to-restart-a-app.md',
    method: 'POST',
    path: '/v1/projects/{name}/actions/restart',
    notes: 'Consequential — approval required.',
  },
  {
    id: 'apps.releases',
    name: 'List app releases',
    verification: 'verified',
    source: 'developers.liara.ir/pass/apps/get-releases-of-app.md',
    method: 'GET',
    path: '/v1/projects/{name}/releases',
    notes: 'Returns total, currentRelease, releases[] with state, port, platform, gitInfo {commit, branch, message}.',
  },
  {
    id: 'deploy.sources',
    name: 'Deploy source archive',
    verification: 'verified',
    source: 'developers.liara.ir/pass/deploy/deploy-sources-code.md',
    method: 'POST',
    path: '/v2/projects/{name}/sources',
    notes: 'multipart/form-data with .gz archive in field `file` (operationId sourcesDeploy). Requires prepared archive; the CLI workflow is generally preferred.',
  },
  {
    id: 'apps.create',
    name: 'Create app',
    verification: 'verified',
    source: 'developers.liara.ir/pass/apps/create-a-app.md',
    method: 'POST',
    path: '/v1/projects',
    notes: 'Body {name, planID, platform}. Verified 2026-10 from the official OpenAPI docs. Used only behind the deploy approval gate (first deploy creates the app).',
  },
  {
    id: 'apps.delete',
    name: 'Delete app',
    verification: 'documented_unverified',
    source: 'developers.liara.ir/pass/apps/delete-a-app.md',
    notes: 'Destructive. Not called by the agent in this MVP.',
  },
  {
    id: 'apps.change_plan',
    name: 'Change resource plan',
    verification: 'documented_unverified',
    source: 'developers.liara.ir/pass/apps/change-plan.md',
    notes: 'Consequential (paid resources). Not called by the agent in this MVP.',
  },
  {
    id: 'apps.events',
    name: 'Get app events',
    verification: 'documented_unverified',
    source: 'developers.liara.ir/pass/apps/get-events-of-the-app.md',
    notes: 'Not called by the agent in this MVP.',
  },
  {
    id: 'reports.cpu',
    name: 'CPU metrics',
    verification: 'documented_unverified',
    source: 'developers.liara.ir/pass/reports/get-cpu-reports-of-app.md',
    notes: 'Documented in index; path/schema unconfirmed — monitoring does NOT claim CPU visibility.',
  },
  {
    id: 'reports.memory',
    name: 'Memory metrics',
    verification: 'documented_unverified',
    source: 'developers.liara.ir/pass/reports/get-memory-reports-of-app.md',
    notes: 'Same as CPU — not used.',
  },
  {
    id: 'reports.network',
    name: 'Network metrics',
    verification: 'documented_unverified',
    source: 'developers.liara.ir/pass/reports/*network*.md',
    notes: 'Same as CPU — not used.',
  },
  {
    id: 'deploy.from_directory',
    name: 'Deploy from prepared local directory',
    verification: 'cli_only',
    source: 'github.com/liara-cloud/cli (liara deploy)',
    notes: 'The standard buildpack deploy path: prepare project directory + liara deploy. Exact flags validated at runtime via `liara deploy --help` before use (adapter refuses unknown flags).',
  },
  {
    id: 'apps.env_set',
    name: 'Set app environment variables',
    verification: 'cli_only',
    source: 'github.com/liara-cloud/cli (liara env set)',
    notes: 'No confirmed API endpoint. CLI only. Approval required.',
  },
  {
    id: 'apps.start_stop',
    name: 'Start/stop app',
    verification: 'cli_only',
    source: 'github.com/liara-cloud/cli (liara app start / app stop); API scale endpoint covers on/off',
    notes: 'API scale action verified for on/off; CLI start/stop also available.',
  },
  {
    id: 'metrics.realtime',
    name: 'Real-time resource metrics stream',
    verification: 'unsupported',
    source: 'absent from official docs index',
    notes: 'Agent never claims CPU/RAM visibility beyond documented reports endpoints.',
  },
  {
    id: 'deploy.api_direct_code',
    name: 'Deploy raw source code directly via API without archive prep',
    verification: 'unsupported',
    source: 'API requires .gz multipart upload (POST /v2/projects/{name}/sources)',
    notes: 'Assumption that the API accepts plain source trees is forbidden by spec §8.',
  },
];

export function capability(id: string): LiaraCapability | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}

/** Explicit refusal text the agent uses when a capability is not available. */
export function unsupportedResponse(id: string): { supported: false; reason: string } {
  const cap = capability(id);
  if (!cap) return { supported: false, reason: `Unknown capability "${id}" — refusing to fabricate.` };
  if (cap.verification === 'documented_unverified') {
    return {
      supported: false,
      reason: `"${cap.name}" is documented by Liara but its exact schema is not yet verified in LiaraPilot's registry. The agent will not call unverified endpoints. Source: ${cap.source}`,
    };
  }
  if (cap.verification === 'unsupported') {
    return { supported: false, reason: `"${cap.name}" is not supported by Liara integrations. ${cap.notes}` };
  }
  return { supported: false, reason: `"${cap.name}" is not callable in the current mode. ${cap.notes}` };
}

// Monitoring layer claims (spec §9 Layer 1): what we actually know
export const MONITORING_CLAIMS = {
  httpAvailability: true, // own HTTP probes — always real
  latencyMeasurement: true, // own measurements
  platformLogs: true, // via verified logs endpoint (bounded)
  platformReleases: true, // via verified releases endpoint
  cpuMetrics: false,
  memoryMetrics: false,
  deploymentEvents: false, // events endpoint documented but unverified
} as const;
