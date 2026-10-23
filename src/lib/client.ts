// Typed API client for the workspace UI.
export interface ProjectSummary {
  id: string;
  name: string;
  repo: string;
  repoProvider: string;
  branch: string;
  liaraAppName: string | null;
  deployedSha: string | null;
  monitorPolicy: string;
  monitorEnabled: boolean;
  openIncidents: Array<{ id: string; kind: string; status: string; title: string; lastSeenAt: string }>;
  lastRun: { id: string; kind: string; status: string; stage: string | null; createdAt: string } | null;
  lastHealth: { status: string; httpStatus: number | null; latencyMs: number | null; at: string } | null;
  pendingApprovals: number;
}

export interface ProjectsResponse {
  pendingApprovals: number;
  projects: ProjectSummary[];
}

export interface ProjectProfileDTO {
  repository: string;
  analyzedSha: string | null;
  language: string | null;
  languageVersion: string | null;
  framework: string | null;
  packageManager: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  appPort: number | null;
  deploymentCandidates: Array<{ method: string; platform: string | null; rationale: string; confidence: string }>;
  requiredEnvVars: Array<{ name: string; required: boolean; source: string }>;
  configFiles: string[];
  hasDockerfile: boolean;
  isDeployable: boolean;
  blockers: string[];
  readmeSummary: string | null;
  evidence: Array<{ file: string; field: string; detail: string }>;
  analyzedAt: string;
}

export interface ProjectDetail {
  project: ProjectSummary & { repoOwner: string; repoName: string; repoBranch: string; healthUrl: string | null; createdAt: string };
  profile: ProjectProfileDTO | null;
  plans: Array<{ id: string; status: string; commitSha: string; plan: Record<string, unknown>; createdAt: string }>;
  executions: Array<{ id: string; method: string; status: string; stage: string | null; exitCode: number | null; commitSha: string; attempts: number; result: Record<string, unknown> | null; createdAt: string; finishedAt: string | null }>;
  incidents: Array<{ id: string; kind: string; status: string; title: string; summary: string | null; firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null }>;
  runs: Array<{ id: string; kind: string; trigger: string; status: string; stage: string | null; createdAt: string; finishedAt: string | null; report: { headline: string; detail: string; nextSteps: string[]; outcome: string } | null }>;
  healthChecks: Array<{ id: string; status: string; httpStatus: number | null; latencyMs: number | null; error: string | null; at: string }>;
  approvals: Array<{ id: string; actionType: string; title: string; status: string; createdAt: string; expiresAt: string }>;
}

export interface Approval {
  id: string;
  projectId: string | null;
  projectName: string | null;
  actionType: string;
  targetRef: string;
  title: string;
  rationale: string;
  evidence: Record<string, unknown>;
  risks: { reversible?: boolean; reasons?: string[]; risk?: string; failureEffects?: string };
  planHash: string;
  payload: Record<string, unknown>;
  status: string;
  expiresAt: string;
  createdAt: string;
  runId: string | null;
  incidentId: string | null;
}

export interface IncidentSummary {
  id: string;
  projectId: string;
  projectName: string;
  kind: string;
  status: string;
  title: string;
  summary: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  runId: string | null;
  hasDiagnosis: boolean;
  hasRemediation: boolean;
}

export interface IncidentDetail {
  incident: IncidentSummary & {
    evidence: Record<string, unknown> | null;
    diagnosis: Record<string, unknown> | null;
    remediation: Record<string, unknown> | null;
  };
  events: Array<{ id: string; node: string; level: string; message: string; at: string }>;
}

export interface RunDetail {
  run: { id: string; kind: string; trigger: string; status: string; stage: string | null; projectId: string | null; report: { headline: string; detail: string; nextSteps: string[]; outcome: string } | null; error: string | null; createdAt: string; finishedAt: string | null };
  events: Array<{ id: string; node: string; level: string; message: string; data: Record<string, unknown> | null; at: string }>;
}

export interface AuditEventDTO {
  id: string;
  kind: string;
  actor: string;
  projectId: string | null;
  detail: Record<string, unknown> | null;
  at: string;
}

export interface ConnectionsResponse {
  github: { login: string | null; via: string; verified: boolean; tokenMask: string; connectedAt: string } | null;
  gitlab: { login: string | null; via: string; verified: boolean; instanceUrl: string; tokenMask: string; connectedAt: string } | null;
  liara: { verified: boolean; accountEmail: string | null; tokenMask: string; connectedAt: string } | null;
  ai: { provider: string; model: string; baseUrl: string; keyMask: string; connectedAt: string } | null;
  appConfig: { githubDevice: boolean; gitlabDevice: boolean };
}

export interface AiSettings {
  connected: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  keyMask?: string | null;
  verified?: boolean;
  connectedAt?: string;
}

export interface LlmStatus {
  provider: 'chatgpt' | 'zai' | 'none';
  model: string | null;
  aiConfigured: boolean;
  aiBaseUrl: string | null;
  aiKeyMask: string | null;
  fallbackAvailable: boolean;
}

export interface DeviceStart {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresAt: string;
}

export type DevicePoll =
  | { status: 'pending' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'done'; login: string }
  | { status: 'error'; error: string };

export interface OAuthAppConfig {
  githubClientId: string | null;
  gitlabClientId: string | null;
  gitlabInstanceUrl: string;
  hasGitlabSecret: boolean;
  updatedAt: string | null;
}

export interface RepoListEntry {
  provider: 'github' | 'gitlab';
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  defaultBranch: string;
  private: boolean;
  pushedAt: string | null;
  stars: number;
  url: string;
  fork: boolean;
}

export interface ReposResponse {
  provider: string;
  connected: boolean;
  repos: RepoListEntry[];
  hint?: string;
}

export interface WorkspaceStats {
  projects: { total: number; deployed: number; byProvider: Record<string, number> };
  runs14d: {
    total: number;
    succeeded: number;
    failed: number;
    active: number;
    successRate: number | null;
    byDay: Array<{ day: string; total: number; succeeded: number; failed: number; active: number }>;
  };
  incidents: { open: number; resolved: number; byKind: Record<string, number> };
  approvals: { pending: number; approved: number; rejected: number };
  health24h: { checks: number; upRate: number | null; avgLatencyMs: number | null };
  recentRuns: Array<{ id: string; kind: string; status: string; trigger: string; projectName: string | null; createdAt: string }>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const err = new Error(data.error ?? `request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  connections: () => request<ConnectionsResponse>('/api/connections'),
  connectGithubPat: (token: string) =>
    request<{ ok: boolean; login: string }>('/api/connections/github', { method: 'POST', body: JSON.stringify({ token }) }),
  disconnectGithub: () => request<{ ok: boolean }>('/api/connections/github', { method: 'DELETE' }),
  connectGitlabPat: (token: string, instanceUrl?: string) =>
    request<{ ok: boolean; login: string; instanceUrl: string }>('/api/connections/gitlab', { method: 'POST', body: JSON.stringify({ token, instanceUrl }) }),
  disconnectGitlab: () => request<{ ok: boolean }>('/api/connections/gitlab', { method: 'DELETE' }),
  connectLiara: (token: string) =>
    request<{ ok: boolean; accountEmail: string | null; fullname: string | null }>('/api/connections/liara', { method: 'POST', body: JSON.stringify({ token }) }),
  disconnectLiara: () => request<{ ok: boolean }>('/api/connections/liara', { method: 'DELETE' }),
  deviceStart: (provider: 'github' | 'gitlab') =>
    request<DeviceStart>(`/api/connections/device/${provider}/start`, { method: 'POST' }),
  devicePoll: (provider: 'github' | 'gitlab', sessionId: string) =>
    request<DevicePoll>(`/api/connections/device/${provider}/poll`, { method: 'POST', body: JSON.stringify({ sessionId }) }),
  aiSettings: () => request<AiSettings>('/api/settings/ai'),
  saveAiSettings: (body: { apiKey?: string; baseUrl?: string; model?: string; test?: boolean }) =>
    request<{ ok: boolean; model: string; baseUrl: string }>('/api/settings/ai', { method: 'PUT', body: JSON.stringify(body) }),
  deleteAiSettings: () => request<{ ok: boolean }>('/api/settings/ai', { method: 'DELETE' }),
  oauthAppConfig: () => request<OAuthAppConfig>('/api/settings/oauth-app'),
  saveOAuthAppConfig: (body: { githubClientId?: string; gitlabClientId?: string; gitlabClientSecret?: string; gitlabInstanceUrl?: string }) =>
    request<{ ok: boolean }>('/api/settings/oauth-app', { method: 'PUT', body: JSON.stringify(body) }),
  llmStatus: () => request<LlmStatus>('/api/settings/llm'),
  projects: () => request<ProjectsResponse>('/api/projects'),
  connectProject: (body: { owner: string; name: string; branch?: string; provider?: string }) =>
    request<{ project: { id: string }; runId: string }>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  projectDetail: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  reanalyze: (id: string) => request<{ profile: ProjectProfileDTO; fromCache: boolean }>(`/api/projects/${id}/analyze`, { method: 'POST' }),
  requestDeploy: (id: string) => request<{ runId: string }>(`/api/projects/${id}/deploy`, { method: 'POST' }),
  runDetail: (id: string) => request<RunDetail>(`/api/workflows/${id}`),
  approvals: (status: string) => request<{ approvals: Approval[] }>(`/api/approvals?status=${status}`),
  decideApproval: (id: string, decision: 'approve' | 'reject', note?: string) =>
    request<{ ok: boolean }>(`/api/approvals/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision, note }) }),
  incidents: (status = 'all') => request<{ incidents: IncidentSummary[] }>(`/api/incidents?status=${status}`),
  incidentDetail: (id: string) => request<IncidentDetail>(`/api/incidents/${id}`),
  investigateIncident: (id: string) => request<{ runId: string }>(`/api/incidents/${id}`, { method: 'POST' }),
  audit: (take = 60) => request<{ events: AuditEventDTO[] }>(`/api/audit?take=${take}`),
  usage: () => request<{ llmInvestigations: number; healthChecks: number; windowHours: number; byKind: Array<{ kind: string; quantity: number; tokensIn: number; tokensOut: number }> }>('/api/usage'),
  stats: () => request<WorkspaceStats>('/api/stats'),
  repos: (provider: 'github' | 'gitlab') => request<ReposResponse>(`/api/repos?provider=${provider}`),
  capabilities: () => request<{ capabilities: Array<{ id: string; name: string; verification: string; notes: string }> }>('/api/capabilities'),
  chat: (projectId: string | null, message: string) =>
    request<{ reply: string; model: string | null; provider: string }>('/api/chat', { method: 'POST', body: JSON.stringify({ projectId, message }) }),
  updateMonitor: (projectId: string, monitorPolicy?: string, monitorEnabled?: boolean, healthUrl?: string) =>
    request<{ ok: boolean }>(`/api/projects/${projectId}/monitor`, {
      method: 'PUT',
      body: JSON.stringify({ ...(monitorPolicy ? { monitorPolicy } : {}), ...(monitorEnabled !== undefined ? { monitorEnabled } : {}), ...(healthUrl !== undefined ? { healthUrl } : {}) }),
    }),
};
