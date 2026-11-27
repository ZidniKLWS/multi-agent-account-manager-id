export type ProviderId = string;
export type AuthState = "unknown" | "authenticated" | "logged_out";
export type ThemeMode = "system" | "light" | "dark";

export interface AccountKey {
  providerId: ProviderId;
  uuid: string;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  shortName: string;
  enabled: boolean;
  statusText: string;
  entryUrl: string;
  homepageUrl: string;
  callbackOrigins: string[];
  verifiedMethods: string[];
}

export interface AppSettings {
  minimizeToTray: boolean;
  globalShortcut: string;
  autoApprove: boolean;
  isolateSameProxyKeepAlive: boolean;
  silentSyncIntervalMins: number;
}

export interface ProxyTestResult {
  ok: boolean;
  latencyMs: number;
  statusCode: number | null;
  targetHost: string;
  usedProxy: boolean;
  message: string;
}

export interface QuotaDetail {
  planLabel: string;
  planValue: string;
  planSubtext: string | null;
  planUsedPercent: number | null;
  extraLabel: string | null;
  extraValue: string | null;
  extraSubtext: string | null;
  extraUsedPercent: number | null;
}

export interface AccountRecord {
  providerId: ProviderId;
  uuid: string;
  alias: string;
  createdAtMs: number;
  autoAlias: boolean;
  proxyUrl: string | null;
  timezone: string | null;
  avatarUrl: string | null;
  quotaText: string | null;
  quotaPercent: number | null;
  quotaDetail: QuotaDetail | null;
  authState: AuthState;
  cookieExpiresAtMs: number | null;
  cookieSessionOnly: boolean;
}

export interface ConflictItem {
  uuid: string;
  providers: ProviderId[];
}

export type GroupReplyStatus =
  | "queued"
  | "sending"
  | "streaming"
  | "done"
  | "needs_auth"
  | "error";

export interface GroupSharedSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
}

export interface GroupMemberRole {
  member: AccountKey;
  role: string;
}

export type GroupWorkflowMode = "parallel" | "review" | "a2a_relay";

export interface GroupThreadBinding {
  member: AccountKey;
  threadUrl: string;
  updatedAtMs: number;
}

export type ExternalAgentKind = "openai_api" | "local_cli";

export interface ExternalAgentRecord {
  id: string;
  kind: ExternalAgentKind;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  command: string;
  args: string[];
  workdir: string | null;
  createdAtMs: number;
}

export interface SiteAdapterConfig {
  id: string;
  name: string;
  hostPatterns: string[];
  composerSelectors: string[];
  sendButtonSelectors: string[];
  stopButtonSelectors: string[];
  messageListSelectors: string[];
  assistantMessageSelectors: string[];
  newChatSelectors: string[];
  newChatUrl: string | null;
  threadUrlPatterns: string[];
  transientStatusWords: string[];
  chatApiPatterns: string[];
  preferEnterSubmit: boolean;
  asyncAgent?: boolean;
}

export interface SiteAdaptersSnapshot {
  adapters: SiteAdapterConfig[];
  overridePath: string;
  hasOverrides: boolean;
  overrideJson: string;
}

export interface GroupChatMessage {
  id: string;
  role: "user" | "assistant" | string;
  sender: AccountKey | null;
  senderName: string;
  content: string;
  createdAtMs: number;
  status: GroupReplyStatus;
  targets: AccountKey[];
  error: string | null;
  stageLabel?: string | null;
  hopDepth?: number;
  autoRoutedChannel?: string | null;
}

export interface GroupChatRecord {
  id: string;
  name: string;
  members: AccountKey[];
  createdAtMs: number;
  messages: GroupChatMessage[];
  sharedContext: string;
  sharedSkills: GroupSharedSkill[];
  memberRoles: GroupMemberRole[];
  workflowMode?: GroupWorkflowMode;
  maxRelayHops?: number;
  threadBindings?: GroupThreadBinding[];
}

export interface AccountPageError {
  providerId: ProviderId;
  uuid: string;
  message: string;
}

export type RoutingStrategy =
  | "smart_balanced"
  | "highest_quota"
  | "least_busy"
  | "priority_based"
  | "manual";

export type AccountFailureAction = "alternate" | "retry" | "stop";

export interface AccountRuleConfig {
  account: AccountKey;
  priority: number; // 1..100, higher means preferred
  maxConcurrent: number; // default 1 for WebView safety
  allowed: boolean;
  allowedAgentIds: string[]; // empty = all agents allowed
}

export interface RouterWeights {
  quota: number;
  health: number;
  load: number;
  priority: number;
}

export interface RouterPolicyConfig {
  strategy: RoutingStrategy;
  minQuotaPercent: number;
  defaultMaxConcurrent: number;
  cooldownSecs: number;
  onFailure: AccountFailureAction;
  allowFallback: boolean;
  weights: RouterWeights;
  manualAccount: AccountKey | null;
  accountRules: AccountRuleConfig[];
  cooldownsUntilMs: Record<string, number>;
  lastAssignedMs: Record<string, number>;
}

export interface AccountLease {
  id: string;
  account: AccountKey;
  holderType: "task_node" | "group_chat";
  holderId: string;
  holderLabel: string;
  acquiredAtMs: number;
  expiresAtMs: number;
}

export interface RouterCandidateEval {
  account: AccountRecord;
  eligible: boolean;
  reasons: string[];
  score: number;
  quotaScore: number;
  healthScore: number;
  loadScore: number;
  priorityScore: number;
  activeLeases: number;
  maxConcurrent: number;
  inCooldown: boolean;
  cooldownRemainingSecs: number;
  remainingQuotaPct: number;
}

export interface RoutingDecisionPreview {
  providerId: ProviderId;
  strategy: RoutingStrategy;
  selected: RouterCandidateEval | null;
  alternatives: RouterCandidateEval[];
  excluded: RouterCandidateEval[];
  reasoning: string[];
}

export type AgentExecutionTarget = "smart_router" | "pinned_account" | "external_agent";

export interface AgentResourcePolicy {
  targetType: AgentExecutionTarget;
  providerId: ProviderId;
  routingMode: RoutingStrategy;
  pinnedAccount: AccountKey | null;
  externalAgentId: string | null;
  accountPool: AccountKey[]; // empty = any eligible account for providerId
  maxConcurrentTasks: number;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  description: string;
  enabled: boolean;
  instructions: string;
  capabilities: string[];
  outputFormat: string;
  reviewRequired: boolean;
  resourcePolicy: AgentResourcePolicy;
  stats: {
    runs: number;
    successes: number;
    failures: number;
    avgLatencyMs: number;
  };
  createdAtMs: number;
}

export type PipelineNodeKind =
  | "start"
  | "agent"
  | "parallel"
  | "review"
  | "condition"
  | "human_approval"
  | "output";

export interface PipelineConditionRule {
  metric: "min_length" | "contains_keyword" | "not_contains_keyword";
  value: string;
  onPassLabel: string;
  onFailLabel: string;
  actionOnFail: "retry_previous" | "halt" | "continue_with_warning";
}

export interface PipelineStep {
  id: string;
  title: string;
  kind: PipelineNodeKind;
  agentId: string | null; // for agent / review nodes
  parallelBranches?: Array<{
    id: string;
    title: string;
    agentId: string;
  }>;
  maxRetries: number;
  condition?: PipelineConditionRule;
  approvalPrompt?: string;
}

export interface WorkflowPipeline {
  id: string;
  name: string;
  description: string;
  version: number;
  steps: PipelineStep[];
  createdAtMs: number;
  updatedAtMs: number;
}

export type TaskStatus =
  | "pending"
  | "running"
  | "paused"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type TaskNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_approval"
  | "skipped";

export interface TaskNodeExecution {
  stepId: string;
  title: string;
  kind: PipelineNodeKind;
  agentId: string | null;
  agentName: string;
  status: TaskNodeStatus;
  attempt: number;
  allocatedResourceLabel: string | null;
  allocatedAccount: AccountKey | null;
  leaseId: string | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  error: string | null;
  summary: string | null;
}

export interface TaskArtifact {
  id: string;
  stepId: string;
  title: string;
  agentName: string;
  format: string;
  content: string;
  createdAtMs: number;
}

export interface TaskEventLog {
  id: string;
  timestampMs: number;
  level: "info" | "success" | "warn" | "error";
  event: string;
  detail: string;
  stepId?: string;
}

export interface OrchestratedTask {
  id: string;
  title: string;
  objective: string;
  context: string;
  outputFormat: string;
  workflowId: string;
  workflowName: string;
  routingStrategy: RoutingStrategy;
  status: TaskStatus;
  currentStepIndex: number;
  pauseRequested: boolean;
  cancelRequested: boolean;
  createdAtMs: number;
  startedAtMs: number | null;
  completedAtMs: number | null;
  nodeExecutions: TaskNodeExecution[];
  artifacts: TaskArtifact[];
  events: TaskEventLog[];
  error: string | null;
}

export interface ManagerSnapshot {
  platform: string;
  providers: ProviderInfo[];
  accounts: AccountRecord[];
  selectedProviderId: ProviderId;
  activeAccount: AccountKey | null;
  switchingAccount: AccountKey | null;
  warmAccounts: AccountKey[];
  lastCommitted: AccountKey | null;
  pendingCleanup: AccountKey[];
  conflicts: ConflictItem[];
  notice: string | null;
  modalActive: boolean;
  settings: AppSettings;
  globalShortcutActive: boolean;
  globalShortcutError: string | null;
  groupChats: GroupChatRecord[];
  activeGroupId: string | null;
  externalAgents: ExternalAgentRecord[];
  accountErrors?: AccountPageError[];
  officialRelayUrl?: string | null;
  routerPolicy?: RouterPolicyConfig;
  accountLeases?: AccountLease[];
  agents?: AgentProfile[];
  workflows?: WorkflowPipeline[];
  tasks?: OrchestratedTask[];
  activeTaskId?: string | null;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseNotes: string;
  pubDate: string | null;
  downloadUrl: string | null;
  sha256: string | null;
  filename: string | null;
  size: number | null;
  releasePageUrl: string;
}

export interface UpdateProgressEvent {
  stage: string;
  downloaded: number;
  total: number | null;
  percent: number | null;
  message: string;
}

export interface InstallUpdateOutcome {
  status: string;
  message: string;
}

export interface DownloadNoticeEvent {
  id: number;
  filename: string;
  status: "started" | "completed" | "failed";
  error?: string | null;
}

export interface ExportSyncBundleResponse {
  filename: string;
  savedPath: string | null;
  downloadId: number | null;
  bundleJson: string;
  accountCount: number;
  cookieAccountCount: number;
}

export interface SyncImportSummary {
  addedAccounts: number;
  updatedAccounts: number;
  importedCookieAccounts: number;
  skippedCookieAccounts: number;
  mergedGroups: number;
  mergedExternalAgents: number;
}

export interface ImportSyncBundleResponse {
  snapshot: ManagerSnapshot;
  summary: SyncImportSummary;
}

export interface LanSyncShareInfo {
  mode?: "lan" | "relay";
  relayUrl?: string | null;
  address: string;
  passphrase: string;
  syncUri: string;
  qrSvg: string;
  expiresAtMs: number;
  maxDownloads: number;
  accountCount: number;
  cookieAccountCount: number;
}

export interface ScanQrResult {
  content: string;
  cancelled: boolean;
}
