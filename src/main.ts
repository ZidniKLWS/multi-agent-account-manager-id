import { invoke, isTauriRuntime, listen } from "./tauri-bridge";
import "./styles.css";
import type {
  AccountKey,
  AccountRecord,
  DownloadNoticeEvent,
  ExternalAgentKind,
  ExternalAgentRecord,
  ExportSyncBundleResponse,
  GroupChatMessage,
  GroupChatRecord,
  GroupMemberRole,
  GroupSharedSkill,
  GroupWorkflowMode,
  ImportSyncBundleResponse,
  InstallUpdateOutcome,
  LanSyncShareInfo,
  ManagerSnapshot,
  ProviderId,
  ProviderInfo,
  ProxyTestResult,
  QuotaDetail,
  ScanQrResult,
  SiteAdaptersSnapshot,
  SyncImportSummary,
  ThemeMode,
  UpdateCheckResult,
  UpdateProgressEvent,
} from "./types";
import {
  bindSmartRouterEvents,
  renderSmartRouterMiddle,
  renderSmartRouterStage,
  resetSmartRouterDraftFromSnapshot,
  type SmartRouterViewDeps,
} from "./features/smart-router-view";
import {
  bindAgentCenterEvents,
  renderAgentCenterMiddle,
  renderAgentCenterStage,
  type AgentCenterViewDeps,
} from "./features/agent-center-view";

type AccountDraft = {
  draft: string;
  proxyDraft: string;
  timezoneDraft: string;
  cookieDraft?: string;
  cookieImporting?: boolean;
  error?: string;
  saving?: boolean;
  proxyTesting?: boolean;
  proxyTestResult?: ProxyTestResult | null;
  confirmClear?: boolean;
};

const TIMEZONE_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Follow System", value: "" },
  { label: "New York", value: "America/New_York" },
  { label: "Los Angeles", value: "America/Los_Angeles" },
  { label: "London", value: "Europe/London" },
  { label: "Tokyo", value: "Asia/Tokyo" },
  { label: "Singapore", value: "Asia/Singapore" },
  { label: "Shanghai", value: "Asia/Shanghai" },
  { label: "UTC", value: "UTC" },
];

type ModalMode =
  | { kind: "none" }
  | ({ kind: "add"; providerId: ProviderId } & AccountDraft)
  | ({ kind: "rename"; account: AccountRecord } & AccountDraft)
  | { kind: "remove"; account: AccountRecord }
  | {
      kind: "group";
      group?: GroupChatRecord;
      nameDraft: string;
      selectedMembers: AccountKey[];
      error?: string;
      saving?: boolean;
    }
  | {
      kind: "group-knowledge";
      group: GroupChatRecord;
      tab: "context" | "skills" | "roles" | "adapters";
      contextDraft: string;
      skillsDraft: GroupSharedSkill[];
      rolesDraft: GroupMemberRole[];
      skillNameDraft: string;
      skillDescDraft: string;
      skillContentDraft: string;
      editingSkillId: string | null;
      adaptersSnap?: SiteAdaptersSnapshot | null;
      adaptersJsonDraft: string;
      adaptersLoaded?: boolean;
      error?: string;
      saving?: boolean;
    }
  | {
      kind: "external-agents";
      editingId: string | null;
      formKind: ExternalAgentKind;
      nameDraft: string;
      baseUrlDraft: string;
      apiKeyDraft: string;
      modelDraft: string;
      commandDraft: string;
      argsDraft: string;
      workdirDraft: string;
      error?: string;
      saving?: boolean;
    }
  | { kind: "delete-group"; group: GroupChatRecord }
  | {
      kind: "settings";
      minimizeToTray: boolean;
      globalShortcut: string;
      autoApprove: boolean;
      isolateSameProxyKeepAlive: boolean;
      silentSyncIntervalMins: number;
      error?: string;
      saving?: boolean;
    }
  | {
      kind: "sync";
      tab: "lan" | "file";
      relayEnabled: boolean;
      relayUrlDraft: string;
      lanSharePassDraft: string;
      lanShareInfo?: LanSyncShareInfo | null;
      lanShareBusy?: boolean;
      lanPullAddrDraft: string;
      lanPullPassDraft: string;
      lanPullBusy?: boolean;
      lanScanBusy?: boolean;
      fileExportPassDraft: string;
      fileExportResult?: ExportSyncBundleResponse | null;
      fileExportBusy?: boolean;
      fileImportJsonDraft: string;
      fileImportFileName?: string;
      fileImportPassDraft: string;
      fileImportBusy?: boolean;
      importSummary?: SyncImportSummary | null;
      copyHint?: string;
      error?: string;
    }
  | { kind: "update" };

type ProviderLogoSpec = { src: string; fullBleed: boolean; monoDark?: boolean };

const PROVIDER_LOGOS: Record<string, ProviderLogoSpec> = {
  muse: { src: "/logos/muse.png", fullBleed: true },
  hark: { src: "/logos/hark.svg", fullBleed: false, monoDark: true },
};

const GROUP_SKILL_PRESETS: Array<Omit<GroupSharedSkill, "id" | "enabled">> = [
  {
    name: "Concise English",
    description: "Require members to give direct conclusions and key points without filler.",
    content: "Always respond in concise English; go straight to conclusions, key rationale, and actionable steps without pleasantries or filler.",
  },
  {
    name: "Architecture & Risk Review",
    description: "Evaluate stability, edge cases, security, and performance.",
    content: "When analyzing technical designs, prioritize edge cases, concurrency races, permission security, and resource usage, and clearly call out trade-offs and risks.",
  },
  {
    name: "Cross Fact-Check",
    description: "Point out flaws in prior statements or assumptions before adding new conclusions.",
    content: "If shared context or prior member replies contain contradictions, flawed assumptions, or omissions, correct them first before adding your own assessment.",
  },
];

const EXTERNAL_AGENT_PRESETS: Array<{
  label: string;
  kind: ExternalAgentKind;
  name: string;
  baseUrl: string;
  model: string;
  command: string;
  args: string;
}> = [
  {
    label: "OpenAI",
    kind: "openai_api",
    name: "GPT-4o",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    command: "",
    args: "",
  },
  {
    label: "DeepSeek",
    kind: "openai_api",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    command: "",
    args: "",
  },
  {
    label: "Ollama Local",
    kind: "openai_api",
    name: "Ollama-Qwen",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen2.5:14b",
    command: "",
    args: "",
  },
  {
    label: "Claude CLI",
    kind: "local_cli",
    name: "Claude-Code",
    baseUrl: "",
    model: "",
    command: "claude",
    args: "-p",
  },
  {
    label: "Codex CLI",
    kind: "local_cli",
    name: "Codex-CLI",
    baseUrl: "",
    model: "",
    command: "codex",
    args: "exec {prompt}",
  },
];

const ICON_EXTERNAL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
const ICON_REFRESH = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`;
const ICON_EDIT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
const ICON_TRASH = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const ICON_USER_PLUS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`;
const ICON_UPDATE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const ICON_SETTINGS = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const ICON_THEME_DARK = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const ICON_THEME_LIGHT = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="6.34" y1="17.66" x2="4.93" y2="19.07"/><line x1="19.07" y1="4.93" x2="17.66" y2="6.34"/></svg>`;
const ICON_THEME_SYSTEM = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
const ICON_BOLT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
const ICON_SORT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M6 12h12"/><path d="M10 18h4"/></svg>`;
const ICON_GROUP = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/></svg>`;
const ICON_PIN = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><line x1="12" x2="12" y1="7" y2="13"/><line x1="15" x2="9" y1="10" y2="10"/></svg>`;
const ICON_SYNC = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
const ICON_QR_SCAN = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" x2="17" y1="12" y2="12"/></svg>`;
const ICON_ROUTER = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7.5 11 16"/><path d="M16 7.5 13 16"/><path d="M8.5 6h7"/></svg>`;
const ICON_AGENT_CENTER = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="3"/><path d="M8 10h2"/><path d="M14 10h2"/><path d="M9 14h6"/><path d="M8 21h8"/><path d="M12 18v3"/></svg>`;
const syncingMsgIds = new Set<string>();

const THEME_STORAGE_KEY = "maam_theme_mode";
const systemDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");
let themeMode: ThemeMode = loadSavedThemeMode();

function loadSavedThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") {
      return raw;
    }
  } catch {
    // ignore storage errors
  }
  return "system";
}

function effectiveTheme(): "light" | "dark" {
  if (themeMode === "system") {
    return systemDarkQuery.matches ? "dark" : "light";
  }
  return themeMode;
}

function applyTheme(): void {
  document.documentElement.dataset.theme = effectiveTheme();
}

function themeLabel(mode: ThemeMode): string {
  if (mode === "dark") return "Dark";
  if (mode === "light") return "Light";
  return "System";
}

function themeIcon(mode: ThemeMode): string {
  if (mode === "dark") return ICON_THEME_DARK;
  if (mode === "light") return ICON_THEME_LIGHT;
  return ICON_THEME_SYSTEM;
}

function cycleThemeMode(): void {
  themeMode = themeMode === "system" ? "light" : themeMode === "light" ? "dark" : "system";
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  } catch {
    // ignore storage errors
  }
  applyTheme();
  rerenderPreservingScroll();
}

applyTheme();
systemDarkQuery.addEventListener("change", () => {
  if (themeMode === "system") {
    applyTheme();
    if (snapshot) {
      rerenderPreservingScroll();
    }
  }
});

let snapshot: ManagerSnapshot | null = null;
let modal: ModalMode = { kind: "none" };
let optimisticSwitching: AccountKey | null = null;
let busy = false;
let viewMode: "provider" | "groups" | "router" | "agent_center" = "provider";
let lastGroupListScroll = 0;
let lastFeatureStageScroll = 0;
let shouldAnimateModal = false;
let modalOverlayScrollTop = 0;
let groupMemberPickerScrollTop = 0;
let modalCardScrollTop = 0;

function modalOverlayClass(): string {
  return shouldAnimateModal ? "inline-modal animate-in" : "inline-modal";
}
const groupDrafts: Record<string, string> = {};
const groupTargets: Record<string, AccountKey[]> = {};
const groupAutoChannels: Record<string, string[]> = {};
let newTopicConfirmGroupId: string | null = null;
const groupScrollOffsets: Record<string, number> = {};
let groupScrolledToBottom = true;
let forceGroupScrollBottom = false;
let groupSending = false;
let lastRenderedUpdateStage: string | null = null;
const copyingCookies = new Set<string>();
let downloadToast: DownloadNoticeEvent | null = null;
let downloadToastTimer: number | undefined;
let draggingAccountUuid: string | null = null;

function clearDownloadToastTimer(): void {
  if (downloadToastTimer !== undefined) {
    window.clearTimeout(downloadToastTimer);
    downloadToastTimer = undefined;
  }
}

function scheduleDownloadToastDismiss(): void {
  clearDownloadToastTimer();
  if (!downloadToast || downloadToast.status === "started") return;
  downloadToastTimer = window.setTimeout(() => {
    downloadToast = null;
    rerenderPreservingScroll();
  }, 12000);
}

const updateState: {
  checking: boolean;
  installing: boolean;
  result: UpdateCheckResult | null;
  progress: UpdateProgressEvent | null;
  error: string | null;
  outcomeStatus: string | null;
  outcomeMessage: string | null;
  lastCheckedAt: number;
  lastFailedAt: number;
} = {
  checking: false,
  installing: false,
  result: null,
  progress: null,
  error: null,
  outcomeStatus: null,
  outcomeMessage: null,
  lastCheckedAt: 0,
  lastFailedAt: 0,
};

const scrollOffsets: Record<string, number> = {};

function isSameKey(a: AccountKey | null, b: AccountRecord): boolean {
  return Boolean(a && a.providerId === b.providerId && a.uuid === b.uuid);
}

function sameAccountKey(a: AccountKey, b: AccountKey): boolean {
  return a.providerId === b.providerId && a.uuid === b.uuid;
}

function isMobilePlatform(platform: ManagerSnapshot["platform"] | undefined): boolean {
  return platform === "android" || platform === "ios";
}

function syncViewModeFromSnapshot(state: ManagerSnapshot | null): void {
  if (!state) return;
  if (isMobilePlatform(state.platform)) {
    viewMode = "provider";
    return;
  }
  if (state.activeGroupId) {
    viewMode = "groups";
  } else if (viewMode === "router" || viewMode === "agent_center") {
    return;
  } else if (state.activeAccount || state.switchingAccount) {
    viewMode = "provider";
  }
}

function findAccountPageError(
  state: ManagerSnapshot | null,
  key: AccountKey
): string | null {
  if (!state?.accountErrors) return null;
  const hit = state.accountErrors.find(
    (e) => e.providerId === key.providerId && e.uuid === key.uuid
  );
  return hit && hit.message.trim() ? hit.message.trim() : null;
}

function isAccountGroupEligible(state: ManagerSnapshot, acc: AccountRecord): boolean {
  const provider = state.providers.find((p) => p.id === acc.providerId);
  if (!provider || !provider.enabled) return false;
  if (acc.authState !== "authenticated") return false;
  if (typeof acc.cookieExpiresAtMs === "number" && acc.cookieExpiresAtMs <= Date.now()) {
    return false;
  }
  if (findAccountPageError(state, acc)) return false;
  return true;
}

function formatShortTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function groupHasNeedsAuth(group: GroupChatRecord): boolean {
  return group.messages.some((m) => m.status === "needs_auth");
}

function isExternalProviderId(providerId: ProviderId): boolean {
  return providerId === "api" || providerId === "cli";
}

function findAccountRecord(state: ManagerSnapshot, key: AccountKey | null): AccountRecord | undefined {
  if (!key || isExternalProviderId(key.providerId)) return undefined;
  return state.accounts.find((a) => a.providerId === key.providerId && a.uuid === key.uuid);
}

function findExternalAgent(state: ManagerSnapshot, key: AccountKey | null): ExternalAgentRecord | undefined {
  if (!key || !isExternalProviderId(key.providerId)) return undefined;
  return (state.externalAgents ?? []).find((e) => e.id === key.uuid);
}

function resolveMemberMeta(
  state: ManagerSnapshot,
  key: AccountKey
): {
  key: AccountKey;
  isExternal: boolean;
  acc?: AccountRecord;
  ext?: ExternalAgentRecord;
  alias: string;
  providerShort: string;
  loggedOut: boolean;
  pageError: string | null;
  warm: boolean;
} {
  if (isExternalProviderId(key.providerId)) {
    const ext = findExternalAgent(state, key);
    return {
      key,
      isExternal: true,
      ext,
      alias: ext?.name ?? key.uuid.slice(0, 6),
      providerShort: key.providerId === "api" ? "API" : "CLI",
      loggedOut: !ext,
      pageError: null,
      warm: Boolean(ext),
    };
  }
  const acc = findAccountRecord(state, key);
  const pInfo = state.providers.find((p) => p.id === key.providerId);
  const loggedOut = !acc || acc.authState === "logged_out";
  return {
    key,
    isExternal: false,
    acc,
    alias: acc?.alias ?? key.uuid.slice(0, 6),
    providerShort: pInfo?.shortName ?? key.providerId.toUpperCase(),
    loggedOut,
    pageError: loggedOut ? null : findAccountPageError(state, key),
    warm: state.warmAccounts.some((w) => sameAccountKey(w, key)),
  };
}

function resolveMemberCategory(
  state: ManagerSnapshot,
  key: AccountKey
): { id: string; label: string } {
  if (key.providerId === "api") {
    return { id: "api", label: "OpenAI API" };
  }
  if (key.providerId === "cli") {
    return { id: "cli", label: "Local CLI" };
  }
  const pInfo = state.providers.find((p) => p.id === key.providerId);
  return {
    id: pInfo?.id ?? key.providerId,
    label: pInfo?.shortName ?? key.providerId.toUpperCase(),
  };
}

function groupByMemberCategory<T extends { key: AccountKey }>(
  state: ManagerSnapshot,
  items: T[]
): Array<{ id: string; label: string; items: T[] }> {
  const buckets = new Map<string, { id: string; label: string; items: T[] }>();
  for (const item of items) {
    const cat = resolveMemberCategory(state, item.key);
    let bucket = buckets.get(cat.id);
    if (!bucket) {
      bucket = { ...cat, items: [] };
      buckets.set(cat.id, bucket);
    }
    bucket.items.push(item);
  }
  const orderedIds: string[] = [
    ...state.providers.map((p) => p.id),
    "api",
    "cli",
  ];
  const result: Array<{ id: string; label: string; items: T[] }> = [];
  for (const id of orderedIds) {
    const b = buckets.get(id);
    if (b && b.items.length > 0) {
      result.push(b);
      buckets.delete(id);
    }
  }
  for (const b of buckets.values()) {
    if (b.items.length > 0) {
      result.push(b);
    }
  }
  return result;
}

function resolveGroupMessageSenderName(state: ManagerSnapshot, msg: GroupChatMessage): string {
  if (msg.sender && isExternalProviderId(msg.sender.providerId)) {
    return findExternalAgent(state, msg.sender)?.name || msg.senderName;
  }
  const acc = findAccountRecord(state, msg.sender);
  return acc?.alias || msg.senderName;
}

function renderMemberAvatarNode(
  _state: ManagerSnapshot,
  acc: AccountRecord | undefined,
  fallbackName: string,
  extraClass = "",
  externalKind?: ExternalAgentKind
): string {
  if (externalKind) {
    const extCls = externalKind === "openai_api" ? "ext-api" : "ext-cli";
    const badge = externalKind === "openai_api" ? "API" : "CLI";
    return `<div class="avatar ${extCls} ${escapeHtml(extraClass)}">${badge}</div>`;
  }
  if (acc?.avatarUrl) {
    return `<div class="avatar has-photo ${escapeHtml(extraClass)}"><img src="${escapeHtml(acc.avatarUrl)}" class="avatar-photo" alt="" draggable="false" /></div>`;
  }
  const cls = acc ? acc.providerId : "custom";
  const initial = Array.from((acc?.alias || fallbackName).trim())[0]?.toUpperCase() || "#";
  return `<div class="avatar ${cls} ${escapeHtml(extraClass)}">${escapeHtml(initial)}</div>`;
}

function effectiveSwitchingKey(state: ManagerSnapshot): AccountKey | null {
  return state.switchingAccount ?? optimisticSwitching;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderProviderLogo(provider: ProviderInfo, extraClass = ""): string {
  const cfg = PROVIDER_LOGOS[provider.id];
  if (cfg) {
    const cls = `${extraClass} ${cfg.fullBleed ? "full-bleed" : ""} ${cfg.monoDark ? "mono-dark-logo" : ""}`.trim();
    return `<img src="${cfg.src}" alt="${escapeHtml(provider.shortName)}" class="${cls}" draggable="false" />`;
  }
  const initial = Array.from(provider.shortName.trim())[0]?.toUpperCase() || "A";
  return `<span class="group-provider-tag ${escapeHtml(extraClass)}">${escapeHtml(initial)}</span>`;
}

function renderCategoryIcon(
  state: ManagerSnapshot,
  cat: { id: string; label: string }
): string {
  if (cat.id === "api") {
    return `<span class="cat-ext-icon ext-api" aria-hidden="true">API</span>`;
  }
  if (cat.id === "cli") {
    return `<span class="cat-ext-icon ext-cli" aria-hidden="true">&gt;_</span>`;
  }
  const provider = state.providers.find((p) => p.id === cat.id);
  if (provider) {
    return renderProviderLogo(provider, "cat-logo-img");
  }
  const initial = Array.from(cat.label.trim())[0]?.toUpperCase() || "A";
  return `<span class="group-provider-tag">${escapeHtml(initial)}</span>`;
}

function computeAvatarText(acc: AccountRecord): string {
  if (acc.autoAlias) {
    return "@";
  }
  const clean = acc.alias.trim();
  const first = Array.from(clean)[0];
  return first ? first.toUpperCase() : "#";
}

function splitQuotaValue(raw: string): { main: string; note: string | null } {
  const m = raw.trim().match(/^(.*?)\s*[（(]([^）)]+)[）)]\s*$/);
  if (m && m[1].trim()) {
    return { main: m[1].trim(), note: m[2].trim() };
  }
  return { main: raw.trim(), note: null };
}

type QuotaStatus = "normal" | "extra" | "low" | "critical";

function resolveQuotaState(acc: AccountRecord): {
  status: QuotaStatus;
  label: string;
  extraDepleted: boolean;
} {
  if (acc.quotaDetail) {
    const d = acc.quotaDetail;
    const planUsed = d.planUsedPercent;
    const planVal = d.planValue || "";
    const planDepleted =
      (planUsed !== null && planUsed >= 100) ||
      planVal.includes("用尽") ||
      /DEPLETED|EXHAUSTED/i.test(planVal);
    const planLow =
      !planDepleted &&
      ((planUsed !== null && planUsed >= 85) ||
        planVal.includes("偏低") ||
        /\bLOW\b/i.test(planVal));
    const hasExtra = Boolean(
      d.extraLabel || d.extraValue || d.extraUsedPercent !== null
    );
    const extraUsed = d.extraUsedPercent;
    const extraVal = d.extraValue || "";
    const extraDepleted =
      hasExtra &&
      ((extraUsed !== null && extraUsed >= 100) ||
        extraVal.includes("用尽") ||
        extraVal.includes("耗尽") ||
        /DEPLETED|EXHAUSTED/i.test(extraVal) ||
        /剩余\s*0(\s|个|口|$)/.test(extraVal) ||
        /\b0%\s*left\b/i.test(extraVal));
    const extraLow =
      hasExtra &&
      !extraDepleted &&
      ((extraUsed !== null && extraUsed >= 85) ||
        extraVal.includes("偏低") ||
        /\bLOW\b/i.test(extraVal));
    const extraIsCap = Boolean(d.extraLabel && /月|monthly/i.test(d.extraLabel));

    if (extraIsCap) {
      if (planDepleted) {
        return { status: "critical", label: "Daily cap", extraDepleted };
      }
      if (extraDepleted) {
        return { status: "critical", label: "Monthly cap", extraDepleted };
      }
      if (planLow || extraLow) {
        return { status: "low", label: "Low", extraDepleted };
      }
      return { status: "normal", label: "", extraDepleted };
    }

    if (planDepleted) {
      if (!hasExtra || extraDepleted) {
        return { status: "critical", label: "Exhausted", extraDepleted };
      }
      if (extraLow) {
        return { status: "low", label: "Low", extraDepleted };
      }
      return { status: "extra", label: "Extra", extraDepleted };
    }
    if (planLow) {
      if (!hasExtra || extraDepleted) {
        return { status: "low", label: "Low", extraDepleted };
      }
      return { status: "normal", label: "", extraDepleted };
    }
    return { status: "normal", label: "", extraDepleted };
  }

  if (acc.quotaPercent === 0 || Boolean(acc.quotaText?.includes("用尽") || /exhausted|depleted/i.test(acc.quotaText ?? ""))) {
    return { status: "critical", label: "Exhausted", extraDepleted: false };
  }
  if (
    (typeof acc.quotaPercent === "number" && acc.quotaPercent <= 15) ||
    Boolean(acc.quotaText?.includes("偏低") || /\blow\b/i.test(acc.quotaText ?? ""))
  ) {
    return { status: "low", label: "Low", extraDepleted: false };
  }
  return { status: "normal", label: "", extraDepleted: false };
}

function scoreAccountAvailability(
  acc: AccountRecord,
  pageError?: string | null
): {
  tier: number;
  score: number;
  available: boolean;
} {
  if (acc.authState === "logged_out" || pageError) {
    return { tier: 0, score: -1, available: false };
  }
  const q = resolveQuotaState(acc);
  if (q.status === "critical") {
    return { tier: 1, score: 0, available: false };
  }
  const d = acc.quotaDetail;
  if (d) {
    if (d.planUsedPercent === null && /无限|UNLIMITED/i.test(d.planValue)) {
      return { tier: 6, score: 100, available: true };
    }
    const extraIsCap = Boolean(d.extraLabel && /月|monthly/i.test(d.extraLabel));
    if (q.status === "extra") {
      const extraRem =
        typeof d.extraUsedPercent === "number" ? Math.max(0, 100 - d.extraUsedPercent) : 50;
      return { tier: 2, score: 200 + extraRem, available: true };
    }
    let rem =
      typeof d.planUsedPercent === "number"
        ? Math.max(0, 100 - d.planUsedPercent)
        : typeof acc.quotaPercent === "number"
          ? acc.quotaPercent
          : 50;
    if (extraIsCap && typeof d.extraUsedPercent === "number") {
      rem = Math.min(rem, Math.max(0, 100 - d.extraUsedPercent));
    }
    return { tier: q.status === "low" ? 3 : 5, score: rem, available: true };
  }
  if (typeof acc.quotaPercent === "number") {
    return { tier: q.status === "low" ? 3 : 5, score: acc.quotaPercent, available: true };
  }
  if (acc.authState === "authenticated") {
    return { tier: 4, score: 50, available: true };
  }
  return { tier: 2, score: 50, available: true };
}

function compareAccountAvailability(
  a: AccountRecord,
  b: AccountRecord,
  state?: ManagerSnapshot | null
): number {
  const sa = scoreAccountAvailability(a, state ? findAccountPageError(state, a) : null);
  const sb = scoreAccountAvailability(b, state ? findAccountPageError(state, b) : null);
  if (sb.tier !== sa.tier) return sb.tier - sa.tier;
  return sb.score - sa.score;
}

function formatShortResetText(raw: string | null): string {
  const clean = (raw ?? "").trim();
  if (!clean) return "";
  const m = clean.match(/^(?:每周限额将在|周限额重置时间[:：]?|将在)\s*(.+?)\s*$/);
  if (m && m[1]) {
    const inner = m[1].replace(/重置$/, "").trim();
    return `Resets ${inner}`;
  }
  return clean;
}

function formatShortExtraText(
  detail: QuotaDetail,
  extraDepleted: boolean
): string | null {
  if (
    !detail.extraLabel &&
    !detail.extraValue &&
    detail.extraUsedPercent === null
  ) {
    return null;
  }
  const prefix = detail.extraLabel && /月|monthly/i.test(detail.extraLabel) ? "Monthly" : "Extra";
  if (extraDepleted) {
    return `${prefix} 100% · Exhausted`;
  }
  const parsed = splitQuotaValue(detail.extraValue ?? "");
  const pctPart =
    typeof detail.extraUsedPercent === "number"
      ? `${detail.extraUsedPercent}%`
      : parsed.main.replace(/^(?:已使用|Used)\s*/i, "").trim();
  const notePart = parsed.note
    ? parsed.note
        .replace(/^剩余\s*/, "Left ")
        .replace(/个?口令$/, "")
        .replace(/\s*tokens?$/i, "")
        .trim()
    : "";
  if (pctPart && notePart) {
    return `${prefix} ${pctPart} · ${notePart}`;
  }
  if (notePart) {
    return `${prefix} · ${notePart}`;
  }
  if (pctPart) {
    return `${prefix} ${pctPart}`;
  }
  return detail.extraLabel ?? "Extra quota";
}

type CookieExpiryTone = "normal" | "warn" | "critical" | "expired" | "session";

interface CookieExpiryDisplay {
  tone: CookieExpiryTone;
  shortText: string;
  detailText: string;
  tooltip: string;
}

function formatLocalDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatCookieExpiry(acc: AccountRecord): CookieExpiryDisplay | null {
  if (acc.authState === "logged_out") return null;

  if (typeof acc.cookieExpiresAtMs === "number") {
    const diffMs = acc.cookieExpiresAtMs - Date.now();
    const absStr = formatLocalDateTime(acc.cookieExpiresAtMs);
    if (diffMs <= 0) {
      return {
        tone: "expired",
        shortText: "Cookie expired",
        detailText: `Cookie expired at ${absStr} (sign in again or refresh)`,
        tooltip: `Cookie expiration: ${absStr}`,
      };
    }

    const days = Math.floor(diffMs / 86_400_000);
    const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
    const mins = Math.max(1, Math.floor((diffMs % 3_600_000) / 60_000));

    const shortText =
      days >= 365
        ? `Cookie ~${(days / 365).toFixed(1).replace(/\.0$/, "")}y`
        : days >= 1
          ? `Cookie ${days}d left`
          : hours >= 1
            ? `Cookie ${hours}h left`
            : `Cookie ${mins}m left`;

    const fullRem =
      days >= 1 && hours > 0
        ? `${days}d ${hours}h`
        : days >= 1
          ? `${days}d`
          : hours >= 1
            ? `${hours}h ${mins}m`
            : `${mins}m`;

    const tone: CookieExpiryTone =
      diffMs <= 24 * 3_600_000
        ? "critical"
        : diffMs <= 7 * 86_400_000
          ? "warn"
          : "normal";

    return {
      tone,
      shortText,
      detailText: `Cookie valid until ${absStr} (${fullRem} left)`,
      tooltip: `Cookie valid until ${absStr}`,
    };
  }

  if (acc.cookieSessionOnly) {
    return {
      tone: "session",
      shortText: "Session only",
      detailText: "Session-only Cookie (may require signing in again after closing)",
      tooltip: "Browser session Cookie with no fixed expiration time",
    };
  }

  return null;
}

function renderQuotaDetailPanel(
  detail: QuotaDetail,
  status: QuotaStatus,
  extraDepleted: boolean
): string {
  const shortVal =
    typeof detail.planUsedPercent === "number"
      ? `${detail.planUsedPercent}%`
      : splitQuotaValue(detail.planValue).main;
  const clamped =
    typeof detail.planUsedPercent === "number"
      ? Math.max(0, Math.min(100, detail.planUsedPercent))
      : null;
  const barHtml =
    clamped !== null
      ? `<div class="quota-bar-track ${status}"><div class="quota-bar-fill ${status} ${clamped > 0 ? "has-fill" : ""}" style="width:${clamped}%"></div></div>`
      : `<div class="quota-compact-spacer"></div>`;

  const rawReset = detail.planSubtext ?? "";
  const shortReset = formatShortResetText(rawReset);
  const shortExtra = formatShortExtraText(detail, extraDepleted);
  const fullExtraTitle = [
    detail.extraLabel,
    detail.extraValue,
    detail.extraSubtext,
  ]
    .filter(Boolean)
    .join(" · ");

  const metaHtml =
    shortReset || shortExtra
      ? `
        <div class="quota-compact-meta">
          <span class="quota-sub-text" title="${escapeHtml(rawReset)}">${escapeHtml(shortReset)}</span>
          ${shortExtra ? `<span class="quota-extra-pill ${status}" title="${escapeHtml(fullExtraTitle)}">${escapeHtml(shortExtra)}</span>` : ""}
        </div>
      `
      : "";

  return `
    <div class="quota-compact-main">
      <span class="quota-plan-label ${status}">${escapeHtml(detail.planLabel)}</span>
      ${barHtml}
      <span class="quota-val ${status}">${escapeHtml(shortVal)}</span>
    </div>
    ${metaHtml}
  `;
}

function saveScrollPosition(): void {
  if (!snapshot) return;
  const listEl = document.querySelector<HTMLElement>(".account-list");
  if (listEl) {
    if (viewMode === "groups") {
      lastGroupListScroll = listEl.scrollTop;
    } else {
      scrollOffsets[snapshot.selectedProviderId] = listEl.scrollTop;
    }
  }
  const msgEl = document.querySelector<HTMLElement>(".group-messages");
  if (msgEl && snapshot.activeGroupId) {
    groupScrolledToBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight <= 64;
    groupScrollOffsets[snapshot.activeGroupId] = msgEl.scrollTop;
  }
  const modalOverlayEl = document.querySelector<HTMLElement>(".inline-modal");
  if (modalOverlayEl) {
    modalOverlayScrollTop = modalOverlayEl.scrollTop;
  }
  const pickerEl = document.querySelector<HTMLElement>(".group-member-picker");
  if (pickerEl) {
    groupMemberPickerScrollTop = pickerEl.scrollTop;
  }
  const modalCardEl = document.querySelector<HTMLElement>(".modal-card");
  if (modalCardEl) {
    modalCardScrollTop = modalCardEl.scrollTop;
  }
  const featureStageEl = document.querySelector<HTMLElement>(".sr-stage");
  if (featureStageEl) {
    lastFeatureStageScroll = featureStageEl.scrollTop;
  }
}

function restoreScrollPosition(): void {
  if (!snapshot) return;
  const listEl = document.querySelector<HTMLElement>(".account-list");
  if (listEl) {
    listEl.scrollTop =
      viewMode === "groups"
        ? lastGroupListScroll
        : (scrollOffsets[snapshot.selectedProviderId] ?? 0);
  }
  const msgEl = document.querySelector<HTMLElement>(".group-messages");
  if (msgEl && snapshot.activeGroupId) {
    if (forceGroupScrollBottom || groupScrolledToBottom) {
      msgEl.scrollTop = msgEl.scrollHeight;
      forceGroupScrollBottom = false;
    } else if (snapshot.activeGroupId in groupScrollOffsets) {
      msgEl.scrollTop = groupScrollOffsets[snapshot.activeGroupId];
    } else {
      msgEl.scrollTop = msgEl.scrollHeight;
    }
  }
  const featureStageEl = document.querySelector<HTMLElement>(".sr-stage");
  if (featureStageEl) {
    featureStageEl.scrollTop = lastFeatureStageScroll;
  }
  if (modal.kind !== "none") {
    const modalOverlayEl = document.querySelector<HTMLElement>(".inline-modal");
    if (modalOverlayEl) {
      modalOverlayEl.scrollTop = modalOverlayScrollTop;
    }
    const pickerEl = document.querySelector<HTMLElement>(".group-member-picker");
    if (pickerEl) {
      pickerEl.scrollTop = groupMemberPickerScrollTop;
    }
    const modalCardEl = document.querySelector<HTMLElement>(".modal-card");
    if (modalCardEl) {
      modalCardEl.scrollTop = modalCardScrollTop;
    }
  }
}

function rerenderPreservingScroll(): void {
  saveScrollPosition();
  render();
  restoreScrollPosition();
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return idx === 0 ? `${Math.round(val)} B` : `${val.toFixed(1)} ${units[idx]}`;
}

function formatProgressSummary(evt: UpdateProgressEvent): string {
  if (evt.stage === "verifying") return "Verifying";
  if (evt.stage === "installing") return "Installing";
  if (evt.stage === "ready") return "Ready";
  if (evt.stage === "needs_permission") return "Permission needed";
  const pct = typeof evt.percent === "number" ? `${evt.percent}%` : "";
  const transferred = evt.total
    ? `${formatBytes(evt.downloaded)} / ${formatBytes(evt.total)}`
    : evt.downloaded > 0
      ? formatBytes(evt.downloaded)
      : "";
  if (pct && transferred) return `${pct} · ${transferred}`;
  return pct || transferred;
}

async function runCheckForUpdates(silent: boolean): Promise<void> {
  if (updateState.checking || updateState.installing) return;
  updateState.checking = true;
  if (!silent) {
    updateState.error = null;
    updateState.outcomeStatus = null;
    updateState.outcomeMessage = null;
    if (modal.kind === "update") {
      rerenderPreservingScroll();
    }
  }
  try {
    const res = await invoke<UpdateCheckResult>("check_for_updates");
    updateState.result = res;
    updateState.error = null;
    updateState.lastCheckedAt = Date.now();
    updateState.lastFailedAt = 0;
  } catch (err) {
    updateState.lastFailedAt = Date.now();
    if (!silent) {
      updateState.error = String(err);
    }
  } finally {
    updateState.checking = false;
    if (!silent || updateState.result?.hasUpdate || modal.kind === "update") {
      rerenderPreservingScroll();
    }
  }
}

async function maybeAutoCheckForUpdates(): Promise<void> {
  if (updateState.checking || updateState.installing) return;
  const now = Date.now();
  if (updateState.lastCheckedAt === 0) {
    if (updateState.lastFailedAt === 0 || now - updateState.lastFailedAt >= 2 * 60 * 1000) {
      await runCheckForUpdates(true);
    }
    return;
  }
  const interval = updateState.result?.hasUpdate ? 2 * 60 * 60 * 1000 : 30 * 60 * 1000;
  if (now - updateState.lastCheckedAt >= interval) {
    await runCheckForUpdates(true);
  }
}

async function runDownloadAndInstall(): Promise<void> {
  const res = updateState.result;
  if (!res?.downloadUrl || updateState.checking || updateState.installing) return;
  updateState.installing = true;
  updateState.error = null;
  updateState.outcomeStatus = null;
  updateState.outcomeMessage = null;
  lastRenderedUpdateStage = "downloading";
  updateState.progress = {
    stage: "downloading",
    downloaded: 0,
    total: res.size,
    percent: 0,
    message: "Preparing download...",
  };
  rerenderPreservingScroll();
  try {
    const outcome = await invoke<InstallUpdateOutcome>("download_and_install_update", {
      request: {
        version: res.latestVersion,
        downloadUrl: res.downloadUrl,
        sha256: res.sha256,
        filename: res.filename,
      },
    });
    updateState.outcomeStatus = outcome.status;
    updateState.outcomeMessage = outcome.message;
  } catch (err) {
    updateState.error = String(err);
  } finally {
    updateState.installing = false;
    rerenderPreservingScroll();
  }
}

async function setModal(next: ModalMode): Promise<void> {
  if (modal.kind === "sync" && next.kind !== "sync" && modal.lanShareInfo) {
    void invoke("stop_lan_sync_share").catch(() => {});
  }
  const prevKind = modal.kind;
  const wasActive = prevKind !== "none";
  const isActive = next.kind !== "none";
  if (next.kind !== prevKind) {
    shouldAnimateModal = isActive;
    modalOverlayScrollTop = 0;
    groupMemberPickerScrollTop = 0;
    modalCardScrollTop = 0;
  }
  modal = next;
  if (wasActive !== isActive) {
    try {
      snapshot = await invoke<ManagerSnapshot>("set_modal_active", {
        active: isActive,
      });
    } catch (err) {
      if (snapshot) {
        snapshot = { ...snapshot, notice: String(err) };
      }
    }
  }
  render();
  if (next.kind === "add" || next.kind === "rename") {
    const input = document.querySelector<HTMLInputElement>("#modal-alias-input");
    if (input) {
      input.focus();
      input.select();
    }
  } else if (next.kind === "group") {
    const input = document.querySelector<HTMLInputElement>("#modal-group-name-input");
    if (input) {
      input.focus();
      input.select();
    }
  } else if (next.kind === "group-knowledge") {
    document.querySelector<HTMLTextAreaElement>("#modal-group-context-input")?.focus();
  } else if (next.kind === "settings") {
    document.querySelector<HTMLInputElement>("#modal-shortcut-input")?.focus();
  } else if (next.kind === "remove" || next.kind === "delete-group") {
    document.querySelector<HTMLButtonElement>("#modal-confirm-btn")?.focus();
  }
}

async function callCommand(
  cmd: string,
  args: Record<string, unknown> = {},
  optimisticTarget: AccountKey | null = null
): Promise<boolean> {
  if (busy) return false;
  busy = true;
  saveScrollPosition();
  if (optimisticTarget) {
    optimisticSwitching = optimisticTarget;
    if (snapshot) {
      snapshot = { ...snapshot, activeAccount: null };
    }
    render();
    restoreScrollPosition();
  }
  try {
    snapshot = await invoke<ManagerSnapshot>(cmd, args);
    syncViewModeFromSnapshot(snapshot);
    return true;
  } catch (err) {
    if (
      (cmd === "add_account" && modal.kind === "add") ||
      (cmd === "rename_account" && modal.kind === "rename") ||
      (cmd === "clear_account_data" && modal.kind === "rename") ||
      (cmd === "import_account_cookies" && modal.kind === "rename") ||
      ((cmd === "create_group_chat" || cmd === "update_group_chat") && modal.kind === "group") ||
      ((cmd === "update_group_knowledge" || cmd === "reset_group_thread_binding") &&
        modal.kind === "group-knowledge") ||
      ((cmd === "upsert_external_agent" || cmd === "delete_external_agent") &&
        modal.kind === "external-agents") ||
      (cmd === "update_app_settings" && modal.kind === "settings")
    ) {
      modal.error = String(err);
    } else if (snapshot) {
      snapshot = { ...snapshot, notice: String(err) };
    }
    return false;
  } finally {
    optimisticSwitching = null;
    busy = false;
    render();
    restoreScrollPosition();
  }
}

function currentProvider(state: ManagerSnapshot): ProviderInfo {
  return (
    state.providers.find((p) => p.id === state.selectedProviderId) ??
    state.providers[0]
  );
}

function renderUpdateModal(): string {
  const res = updateState.result;
  const curVer = res ? res.currentVersion : "...";
  const hasUpdate = Boolean(res?.hasUpdate);
  const title = hasUpdate
    ? `New Version v${escapeHtml(res!.latestVersion)}`
    : "Check for Updates";

  const versionRow = res
    ? `
      <div class="update-version-row">
        <span class="update-version-pill">Current v${escapeHtml(curVer)}</span>
        ${
          hasUpdate
            ? `<span>→</span><span class="update-version-pill latest">Latest v${escapeHtml(res.latestVersion)}</span>`
            : ""
        }
        ${res.size ? `<span class="update-size-label">${escapeHtml(formatBytes(res.size))}</span>` : ""}
      </div>
    `
    : `<div class="modal-desc">Connecting to GitHub Releases to check for updates...</div>`;

  let bodyHtml = "";
  if (updateState.checking && !res) {
    bodyHtml = `
      <div class="update-progress-wrap">
        <div class="update-progress-track"><div class="update-progress-fill indeterminate"></div></div>
      </div>
    `;
  } else if (res) {
    const noteText = res.releaseNotes.trim();
    if (hasUpdate) {
      bodyHtml += `<div class="update-notes">${escapeHtml(noteText || "Includes stability improvements and bug fixes.")}</div>`;
      if (!res.downloadUrl) {
        bodyHtml += `<div class="modal-desc">This release does not include an automatic installer for your platform. Click "Release Page" to download manually.</div>`;
      }
    } else {
      bodyHtml += `<div class="modal-desc">${escapeHtml(noteText || "You are already on the latest version.")}</div>`;
    }
  }

  const prog = updateState.progress;
  const showProgress =
    prog &&
    prog.stage !== "error" &&
    (updateState.installing ||
      updateState.outcomeStatus === "restarting" ||
      prog.stage === "ready");
  if (showProgress) {
    lastRenderedUpdateStage = prog.stage;
    const isIndeterminate = prog.percent === null;
    const widthStyle = isIndeterminate ? "" : `style="width:${Math.max(0, Math.min(100, prog.percent!))}%"`;
    bodyHtml += `
      <div class="update-progress-wrap">
        <div class="update-progress-meta">
          <span id="update-progress-text">${escapeHtml(prog.message)}</span>
          <span id="update-progress-pct" class="update-progress-pct">${escapeHtml(formatProgressSummary(prog))}</span>
        </div>
        <div class="update-progress-track">
          <div id="update-progress-bar" class="update-progress-fill ${isIndeterminate ? "indeterminate" : ""}" ${widthStyle}></div>
        </div>
      </div>
    `;
  }

  if (updateState.outcomeMessage) {
    bodyHtml += `<div class="update-outcome-box">${escapeHtml(updateState.outcomeMessage)}</div>`;
  }
  if (updateState.error) {
    bodyHtml += `<div class="update-error-box">${escapeHtml(updateState.error)}</div>`;
  }

  const canInstall = hasUpdate && Boolean(res?.downloadUrl);
  const disablePrimary =
    updateState.checking ||
    updateState.installing ||
    updateState.outcomeStatus === "restarting";
  const primaryBtn = canInstall
    ? `<button id="update-install-btn" class="btn primary" type="button" ${disablePrimary ? "disabled" : ""}>${
        updateState.installing
          ? "Updating..."
          : updateState.outcomeStatus === "needs_permission"
            ? "Authorized, Continue Install"
            : snapshot?.platform === "ios"
              ? "Download IPA"
              : "Download & Update"
      }</button>`
    : `<button id="update-recheck-btn" class="btn primary" type="button" ${disablePrimary ? "disabled" : ""}>${
        updateState.checking ? "Checking..." : "Check Again"
      }</button>`;

  const pageBtn = res?.releasePageUrl
    ? `<button id="update-open-page-btn" class="btn" type="button">Release Page</button>`
    : "";

  return `
    <div class="${modalOverlayClass()}" role="dialog" aria-modal="true">
      <div class="modal-card">
        <div class="modal-title">${title}</div>
        ${versionRow}
        ${bodyHtml}
        <div class="modal-footer">
          <button id="modal-cancel-btn" class="btn" type="button" ${updateState.installing ? "disabled" : ""}>Close</button>
          ${pageBtn}
          ${primaryBtn}
        </div>
      </div>
    </div>
  `;
}

function supportsAccountProxy(platform: ManagerSnapshot["platform"]): boolean {
  return platform === "macos" || platform === "windows" || platform === "ios";
}

function formatGroupPickerHint(
  eligibleCount: number,
  ineligibleCount: number,
  selectedCount: number,
  hasPickerContent: boolean
): string {
  if (eligibleCount === 0 && !hasPickerContent) {
    return "No members available. Please sign in to a web account or add an API / CLI member first.";
  }
  if (ineligibleCount > 0) {
    return `Filtered out ${ineligibleCount} signed-out or expired web account(s) (selected ${selectedCount}/30).`;
  }
  return `Supports mixed web account and API / CLI collaboration (selected ${selectedCount}/30).`;
}

function renderModal(state: ManagerSnapshot, provider: ProviderInfo): string {
  const platform = state.platform;
  if (modal.kind === "none") return "";
  if (modal.kind === "update") {
    return renderUpdateModal();
  }
  if (modal.kind === "sync") {
    const busyAny = Boolean(
      modal.lanShareBusy ||
        modal.lanPullBusy ||
        modal.lanScanBusy ||
        modal.fileExportBusy ||
        modal.fileImportBusy
    );
    const shareInfo = modal.lanShareInfo;
    const isRelayActive = shareInfo?.mode === "relay";
    const exportRes = modal.fileExportResult;
    const summary = modal.importSummary;
    const tabBody =
      modal.tab === "lan"
        ? `
          <div class="sync-section">
            <div class="sync-section-title">As Sender (Create Temporary Encrypted Share)</div>
            <label class="sync-relay-toggle">
              <input id="sync-relay-toggle" type="checkbox" ${modal.relayEnabled ? "checked" : ""} ${busyAny ? "disabled" : ""} />
              <span>Enable official / Cloudflare encrypted relay channel (off by default; optional across networks or proxies)</span>
            </label>
            ${
              modal.relayEnabled
                ? `
              <div class="sync-privacy-note">No user data collected: each sync generates a one-time local 256-bit key for AES-256-GCM end-to-end encryption. The key lives only in the QR code/sync URI and is never uploaded; the relay stores ciphertext only and deletes it after 3 minutes or retrieval.</div>
              <div class="sync-inline-row">
                <input id="sync-relay-url" class="modal-input" maxlength="260" placeholder="Official or self-hosted Cloudflare Worker URL (https://...)" value="${escapeHtml(modal.relayUrlDraft)}" autocomplete="off" spellcheck="false" ${busyAny ? "disabled" : ""} />
                <button id="sync-lan-start-btn" class="btn primary" type="button" ${busyAny ? "disabled" : ""}>${modal.lanShareBusy ? "Uploading..." : isRelayActive ? "Regenerate" : "Generate Encrypted Relay Code"}</button>
              </div>
            `
                : `
              <div class="modal-hint">Direct peer-to-peer over local LAN by default (auto-closes after 3 minutes or up to 3 pulls).</div>
              <div class="sync-inline-row">
                <input id="sync-lan-share-pass" class="modal-input" maxlength="64" placeholder="Sync passcode (leave blank for auto 6-digit PIN)" value="${escapeHtml(modal.lanSharePassDraft)}" autocomplete="off" spellcheck="false" ${busyAny ? "disabled" : ""} />
                <button id="sync-lan-start-btn" class="btn primary" type="button" ${busyAny ? "disabled" : ""}>${modal.lanShareBusy ? "Starting..." : shareInfo && !isRelayActive ? "Restart Share" : "Start Sharing"}</button>
              </div>
            `
            }
            ${
              shareInfo
                ? `
              <div class="sync-qr-wrap">
                <div class="sync-qr-box">${shareInfo.qrSvg}</div>
                <div class="sync-meta-grid">
                  <span class="sync-meta-label">${isRelayActive ? "Relay Channel" : "LAN Address"}</span>
                  <span class="sync-meta-val">${escapeHtml(shareInfo.address)}</span>
                  <span class="sync-meta-label">${isRelayActive ? "E2E Encryption" : "Passcode"}</span>
                  <span class="sync-meta-val">${escapeHtml(shareInfo.passphrase)}</span>
                  <span class="sync-meta-label">Bundle Contents</span>
                  <span>${shareInfo.accountCount} accounts (${shareInfo.cookieAccountCount} with cookies)</span>
                  <span class="sync-meta-label">${isRelayActive ? "Deletion Policy" : "Validity"}</span>
                  <span>~3 minutes / up to ${shareInfo.maxDownloads} pulls${isRelayActive ? " before auto-delete" : ""}</span>
                </div>
                <div class="sync-ops-row">
                  <button id="sync-lan-copy-uri-btn" class="mini-btn" type="button">Copy Sync URI</button>
                  <button id="sync-lan-stop-btn" class="mini-btn danger-btn" type="button">${isRelayActive ? "Destroy & Stop" : "Stop Sharing"}</button>
                </div>
              </div>
            `
                : ""
            }
          </div>
          <div class="sync-section">
            <div class="sync-section-title">As Receiver (Scan QR or Paste Sync URI)</div>
            ${
              isMobilePlatform(state.platform)
                ? `<button id="sync-lan-scan-btn" class="btn primary sync-scan-btn" type="button" ${busyAny ? "disabled" : ""}>${ICON_QR_SCAN}<span>${modal.lanScanBusy ? "Scanning & syncing..." : "Scan QR to Sync"}</span></button>`
                : ""
            }
            <input id="sync-lan-pull-addr" class="modal-input" maxlength="512" placeholder="Enter LAN address or paste maam-sync:// sync URI (LAN & relay supported)" value="${escapeHtml(modal.lanPullAddrDraft)}" autocomplete="off" spellcheck="false" ${busyAny ? "disabled" : ""} />
            <div class="sync-inline-row">
              <input id="sync-lan-pull-pass" class="modal-input" maxlength="128" placeholder="Passcode or E2E key fragment from QR code" value="${escapeHtml(modal.lanPullPassDraft)}" autocomplete="off" spellcheck="false" ${busyAny ? "disabled" : ""} />
              <button id="sync-lan-pull-btn" class="btn primary" type="button" ${busyAny ? "disabled" : ""}>${modal.lanPullBusy ? "Pulling..." : "Pull & Merge"}</button>
            </div>
          </div>
        `
        : `
          <div class="sync-section">
            <div class="sync-section-title">Export Encrypted Backup (.maam)</div>
            <div class="modal-hint">AES-256-GCM end-to-end encryption covering all accounts, proxies, time zones, group chats, and Cookie sessions.</div>
            <div class="sync-inline-row">
              <input id="sync-file-export-pass" class="modal-input" type="password" maxlength="128" placeholder="Set encryption passphrase (min 4 characters)" value="${escapeHtml(modal.fileExportPassDraft)}" autocomplete="off" ${busyAny ? "disabled" : ""} />
              <button id="sync-file-export-btn" class="btn primary" type="button" ${busyAny ? "disabled" : ""}>${modal.fileExportBusy ? "Exporting..." : "Export Backup"}</button>
            </div>
            ${
              exportRes
                ? `
              <div class="modal-hint">Encrypted ${exportRes.accountCount} accounts (${exportRes.cookieAccountCount} with cookies).${exportRes.savedPath ? `<br/>Saved: <code>${escapeHtml(exportRes.savedPath)}</code>` : ""}</div>
              <div class="sync-ops-row">
                ${exportRes.downloadId != null ? `<button id="sync-file-reveal-btn" class="mini-btn" type="button">Show File Location</button>` : ""}
                <button id="sync-file-download-btn" class="mini-btn" type="button">Save .maam File</button>
                <button id="sync-file-copy-btn" class="mini-btn" type="button">Copy Ciphertext</button>
              </div>
            `
                : ""
            }
          </div>
          <div class="sync-section">
            <div class="sync-section-title">Import & Decrypt Backup</div>
            <input id="sync-file-picker" class="sync-file-input" type="file" accept=".maam,.json,application/json,text/plain" ${busyAny ? "disabled" : ""} />
            ${modal.fileImportFileName ? `<div class="modal-hint">Loaded file: ${escapeHtml(modal.fileImportFileName)}</div>` : ""}
            <textarea id="sync-file-import-json" class="modal-textarea compact-cookie-textarea" rows="3" placeholder="Or paste the full encrypted .maam backup content here" spellcheck="false" ${busyAny ? "disabled" : ""}>${escapeHtml(modal.fileImportJsonDraft)}</textarea>
            <div class="sync-inline-row">
              <input id="sync-file-import-pass" class="modal-input" type="password" maxlength="128" placeholder="Enter backup decryption passphrase" value="${escapeHtml(modal.fileImportPassDraft)}" autocomplete="off" ${busyAny ? "disabled" : ""} />
              <button id="sync-file-import-btn" class="btn primary" type="button" ${busyAny ? "disabled" : ""}>${modal.fileImportBusy ? "Importing..." : "Decrypt & Import"}</button>
            </div>
          </div>
        `;
    return `
      <div class="${modalOverlayClass()}" role="dialog" aria-modal="true">
        <div class="modal-card sync-modal-card">
          <div class="modal-title">Multi-Device Encrypted Sync</div>
          <div class="sync-tabs">
            <button id="sync-tab-lan" class="sync-tab-btn ${modal.tab === "lan" ? "active" : ""}" type="button" ${busyAny ? "disabled" : ""}>QR / LAN</button>
            <button id="sync-tab-file" class="sync-tab-btn ${modal.tab === "file" ? "active" : ""}" type="button" ${busyAny ? "disabled" : ""}>Encrypted Backup File</button>
          </div>
          ${tabBody}
          ${
            summary
              ? `<div class="sync-summary-box">Sync succeeded: added ${summary.addedAccounts} accounts, updated ${summary.updatedAccounts} accounts, imported ${summary.importedCookieAccounts} login sessions${summary.mergedGroups > 0 ? `, merged ${summary.mergedGroups} group chats` : ""}${summary.skippedCookieAccounts > 0 ? ` (${summary.skippedCookieAccounts} cookies skipped)` : ""}</div>`
              : ""
          }
          ${modal.copyHint ? `<div class="modal-hint">${escapeHtml(modal.copyHint)}</div>` : ""}
          ${modal.error ? `<div id="modal-error-box" class="update-error-box" role="alert">${escapeHtml(modal.error)}</div>` : ""}
          <div class="modal-footer">
            <button id="modal-cancel-btn" class="btn" type="button" ${busyAny ? "disabled" : ""}>Close</button>
          </div>
        </div>
      </div>
    `;
  }
  if (modal.kind === "settings") {
    const saving = Boolean(modal.saving);
    const shortcutPresets = [
      { label: "Default", val: "CommandOrControl+Shift+M" },
      { label: "Alt+Space", val: "Alt+Space" },
      { label: "Cmd/Ctrl+Alt+A", val: "CommandOrControl+Alt+A" },
      { label: "Disable", val: "" },
    ];
    const statusText = state.globalShortcutActive
      ? "Shortcut active"
      : state.globalShortcutError
        ? state.globalShortcutError
        : state.settings.globalShortcut
          ? "Inactive"
          : "Disabled";
    const intervalPresets = [
      { label: "5 min", val: 5 },
      { label: "15 min", val: 15 },
      { label: "30 min", val: 30 },
      { label: "Manual only", val: 0 },
    ];
    return `
      <div class="${modalOverlayClass()}" role="dialog" aria-modal="true">
        <div class="modal-card">
          <div class="modal-title">Desktop Settings</div>
          <label class="setting-row" for="modal-tray-checkbox">
            <span class="setting-label">Minimize to system tray when closing main window</span>
            <input id="modal-tray-checkbox" class="setting-checkbox" type="checkbox" ${modal.minimizeToTray ? "checked" : ""} ${saving ? "disabled" : ""} />
          </label>
          <label class="setting-row" for="modal-auto-approve-checkbox">
            <span class="setting-label">Auto-approve permission prompts (active & background warm accounts)</span>
            <input id="modal-auto-approve-checkbox" class="setting-checkbox" type="checkbox" ${modal.autoApprove ? "checked" : ""} ${saving ? "disabled" : ""} />
          </label>
          <div class="modal-hint">Automatically clicks Allow on tool authorization dialogs for warmed accounts while skipping high-risk actions like delete, sign out, or payment.</div>
          <label class="setting-row" for="modal-isolate-proxy-checkbox">
            <span class="setting-label">Keep only active account warm per shared proxy (anti-rate-limit)</span>
            <input id="modal-isolate-proxy-checkbox" class="setting-checkbox" type="checkbox" ${modal.isolateSameProxyKeepAlive ? "checked" : ""} ${saving ? "disabled" : ""} />
          </label>
          <div class="modal-hint">When enabled, same-platform accounts sharing a proxy or system network keep only the active view warm and release old views on switch.</div>
          <div class="setting-field">
            <div class="setting-field-head">
              <label class="modal-desc" for="modal-sync-interval-input">Background keep-alive / quota check interval (minutes)</label>
            </div>
            <input id="modal-sync-interval-input" class="modal-input" type="number" min="0" max="120" step="1" value="${escapeHtml(String(modal.silentSyncIntervalMins))}" ${saving ? "disabled" : ""} />
            <div class="preset-chips">
              ${intervalPresets
                .map(
                  (p) =>
                    `<button class="preset-chip" data-sync-interval-preset="${p.val}" type="button" ${saving ? "disabled" : ""}>${escapeHtml(p.label)}</button>`
                )
                .join("")}
            </div>
            <div class="modal-hint">Applies to window focus and scheduled checks; set to 0 for manual refresh only.</div>
          </div>
          <div class="setting-field">
            <div class="setting-field-head">
              <label class="modal-desc" for="modal-shortcut-input">Global show / hide shortcut</label>
              <span class="shortcut-status-pill ${state.globalShortcutActive ? "ok" : state.globalShortcutError ? "err" : ""}" title="${escapeHtml(statusText)}">${escapeHtml(state.globalShortcutActive ? "Active" : state.globalShortcutError ? "Failed" : "Not set")}</span>
            </div>
            <input id="modal-shortcut-input" class="modal-input" maxlength="80" placeholder="CommandOrControl+Shift+M (leave blank to disable)" value="${escapeHtml(modal.globalShortcut)}" autocomplete="off" spellcheck="false" ${saving ? "disabled" : ""} />
            <div class="preset-chips">
              ${shortcutPresets
                .map(
                  (p) =>
                    `<button class="preset-chip" data-shortcut-preset="${escapeHtml(p.val)}" type="button" ${saving ? "disabled" : ""}>${escapeHtml(p.label)}</button>`
                )
                .join("")}
            </div>
            ${state.globalShortcutError && !modal.error ? `<div class="modal-hint error-hint">${escapeHtml(state.globalShortcutError)}</div>` : `<div class="modal-hint">Press this shortcut in any app to toggle the main window; use the tray menu to quit completely.</div>`}
          </div>
          ${modal.error ? `<div id="modal-error-box" class="update-error-box" role="alert">${escapeHtml(modal.error)}</div>` : ""}
          <div class="modal-footer">
            <button id="modal-cancel-btn" class="btn" type="button" ${saving ? "disabled" : ""}>Cancel</button>
            <button id="modal-confirm-btn" class="btn primary" type="button" ${saving ? "disabled" : ""}>${saving ? "Saving..." : "Save"}</button>
          </div>
        </div>
      </div>
    `;
  }
  if (modal.kind === "add" || modal.kind === "rename") {
    const creating = modal.kind === "add";
    const saving = Boolean(modal.saving);
    const proxyTesting = Boolean(modal.proxyTesting);
    const supportsProxy = supportsAccountProxy(platform);
    const title = creating
      ? `Add ${escapeHtml(provider.shortName)} Account`
      : "Account Settings";
    const aliasPlaceholder = creating
      ? "Display name (leave blank to auto-detect login email)"
      : "Display name (leave blank to keep current name)";
    const testRes = modal.proxyTestResult;
    const renameAcc = modal.kind === "rename" ? modal.account : null;
    const currentAcc = renameAcc
      ? (state.accounts.find(
          (a) => a.providerId === renameAcc.providerId && a.uuid === renameAcc.uuid
        ) ?? renameAcc)
      : null;
    const cookieInfo = currentAcc ? formatCookieExpiry(currentAcc) : null;
    return `
      <div class="${modalOverlayClass()}" role="dialog" aria-modal="true">
        <div class="modal-card">
          <div class="modal-title">${title}</div>
          <input id="modal-alias-input" class="modal-input" maxlength="60" placeholder="${aliasPlaceholder}" aria-label="Display name" value="${escapeHtml(modal.draft)}" ${saving ? "disabled" : ""} />
          ${supportsProxy ? `
            <label class="modal-desc" for="modal-proxy-input">HTTP CONNECT Proxy (leave blank to use system network)</label>
            <div class="proxy-input-row">
              <input id="modal-proxy-input" class="modal-input" maxlength="512" placeholder="http://127.0.0.1:7890" value="${escapeHtml(modal.proxyDraft)}" autocomplete="off" spellcheck="false" ${saving ? "disabled" : ""} />
              ${!isMobilePlatform(platform) ? `<button id="proxy-test-btn" class="btn mini-test-btn" type="button" ${saving || proxyTesting ? "disabled" : ""}>${proxyTesting ? "Testing..." : "Test Connection"}</button>` : ""}
            </div>
            ${testRes ? `<div id="proxy-test-result" class="proxy-test-box ${testRes.ok ? "ok" : "err"}">${escapeHtml(testRes.message)}</div>` : ""}
            <div class="modal-hint">Applies only to embedded views; external browser sign-in and update checks bypass this proxy.</div>
          ` : ""}
          <label class="modal-desc" for="modal-timezone-input">Custom Time Zone (leave blank for system default)</label>
          <input id="modal-timezone-input" class="modal-input" maxlength="64" placeholder="IANA time zone (e.g. America/New_York, Asia/Tokyo)" value="${escapeHtml(modal.timezoneDraft)}" autocomplete="off" spellcheck="false" ${saving ? "disabled" : ""} />
          <div class="preset-chips">
            ${TIMEZONE_PRESETS.map(
              (p) =>
                `<button class="preset-chip" data-timezone-preset="${escapeHtml(p.value)}" type="button" ${saving ? "disabled" : ""}>${escapeHtml(p.label)}</button>`
            ).join("")}
          </div>
          <div class="modal-hint">${platform === "windows" ? "Applied per account via native WebView2 API; leave blank for system time zone." : "Injected before document load with DST support; leave blank for system time zone."}</div>
          ${cookieInfo ? `<div class="cookie-detail-box ${cookieInfo.tone}" title="${escapeHtml(cookieInfo.tooltip)}"><span class="cookie-expiry-dot"></span><span>${escapeHtml(cookieInfo.detailText)}</span></div>` : ""}
          <div class="cookie-import-section">
            <label class="modal-desc" for="modal-cookie-import-input">${creating ? "Import Cookies (optional, paste after signing in via Chrome)" : "Import Cookies (paste after signing in via Chrome)"}</label>
            <textarea id="modal-cookie-import-input" class="modal-textarea compact-cookie-textarea" rows="3" placeholder="Paste Cookie header (a=1; b=2), Netscape cookies.txt, or browser JSON export array..." ${saving ? "disabled" : ""}>${escapeHtml(modal.cookieDraft ?? "")}</textarea>
            ${creating ? `
              <div class="modal-hint">Leave blank to sign in manually later, or paste cookies and click "Create & Open" to import and sign in directly.</div>
            ` : `
              <div class="cookie-import-actions">
                <span class="modal-hint">Useful when Google OAuth cannot sign in inside the embedded view; auto-reloads after import.</span>
                <button id="modal-import-cookie-btn" class="btn mini-test-btn" type="button" ${saving || modal.cookieImporting ? "disabled" : ""}>${modal.cookieImporting ? "Importing..." : "Import Cookies"}</button>
              </div>
            `}
          </div>
          ${modal.error ? `<div id="modal-error-box" class="update-error-box" role="alert">${escapeHtml(modal.error)}</div>` : ""}
          <div class="modal-footer">
            ${!creating ? `<button id="modal-clear-data-btn" class="btn danger-outline left-action" type="button" ${saving ? "disabled" : ""}>${modal.confirmClear ? "Confirm Clear?" : "Clear Login Cache"}</button>` : ""}
            <button id="modal-cancel-btn" class="btn" type="button" ${saving ? "disabled" : ""}>Cancel</button>
            <button id="modal-confirm-btn" class="btn primary" type="button" ${saving ? "disabled" : ""}>${saving ? (creating ? "Creating..." : "Saving...") : (creating ? "Create & Open" : "Save")}</button>
          </div>
        </div>
      </div>
    `;
  }
  if (modal.kind === "group") {
    const gModal = modal;
    const editing = Boolean(gModal.group);
    const saving = Boolean(gModal.saving);
    const extAgents = state.externalAgents ?? [];
    const eligibleCount =
      state.accounts.filter((a) => isAccountGroupEligible(state, a)).length + extAgents.length;
    const ineligibleCount = state.accounts.length + extAgents.length - eligibleCount;

    const providerGroupsHtml = state.providers
      .filter((p) => p.enabled)
      .map((p) => {
        const accs = state.accounts.filter((a) => {
          if (a.providerId !== p.id) return false;
          if (isAccountGroupEligible(state, a)) return true;
          return Boolean(
            editing &&
              a.authState !== "logged_out" &&
              gModal.selectedMembers.some((m) => m.providerId === a.providerId && m.uuid === a.uuid)
          );
        });
        if (accs.length === 0) return "";
        return `
          <div class="group-picker-section">
            <div class="group-picker-provider">${renderProviderLogo(p, "group-picker-plogo")}<span>${escapeHtml(p.shortName)}</span></div>
            <div class="group-member-list">
              ${accs
                .map((acc) => {
                  const checked = gModal.selectedMembers.some(
                    (m) => m.providerId === acc.providerId && m.uuid === acc.uuid
                  );
                  const cookieHint = formatCookieExpiry(acc);
                  return `
                    <button
                      class="group-member-option ${checked ? "selected" : ""}"
                      data-toggle-group-member="1"
                      data-member-provider="${escapeHtml(acc.providerId)}"
                      data-member-uuid="${escapeHtml(acc.uuid)}"
                      type="button"
                      ${saving ? "disabled" : ""}
                    >
                      <span class="group-check-box">${checked ? "✓" : ""}</span>
                      ${renderMemberAvatarNode(state, acc, acc.alias, "mini")}
                      <span class="group-option-meta">
                        <span class="group-option-name">${escapeHtml(acc.alias)}</span>
                        ${cookieHint ? `<span class="group-option-sub">${escapeHtml(cookieHint.shortText)}</span>` : ""}
                      </span>
                    </button>
                  `;
                })
                .join("")}
            </div>
          </div>
        `;
      })
      .filter(Boolean)
      .join("");

    const extKindGroups: Array<{ kind: ExternalAgentKind; title: string; pid: "api" | "cli" }> = [
      { kind: "openai_api", title: "OpenAI API", pid: "api" },
      { kind: "local_cli", title: "Local CLI", pid: "cli" },
    ];
    const externalGroupHtml = extKindGroups
      .map(({ kind, title, pid }) => {
        const list = extAgents.filter((e) => e.kind === kind);
        if (list.length === 0) return "";
        return `
          <div class="group-picker-section">
            <div class="group-picker-provider"><span>${escapeHtml(title)}</span><span class="group-provider-tag">Direct</span></div>
            <div class="group-member-list">
              ${list
                .map((ext) => {
                  const checked = gModal.selectedMembers.some(
                    (m) => m.providerId === pid && m.uuid === ext.id
                  );
                  const sub =
                    ext.kind === "openai_api"
                      ? ext.model
                      : ext.command;
                  return `
                    <button
                      class="group-member-option ${checked ? "selected" : ""}"
                      data-toggle-group-member="1"
                      data-member-provider="${pid}"
                      data-member-uuid="${escapeHtml(ext.id)}"
                      type="button"
                      ${saving ? "disabled" : ""}
                    >
                      <span class="group-check-box">${checked ? "✓" : ""}</span>
                      ${renderMemberAvatarNode(state, undefined, ext.name, "mini", ext.kind)}
                      <span class="group-option-meta">
                        <span class="group-option-name">${escapeHtml(ext.name)}</span>
                        <span class="group-option-sub">${escapeHtml(sub)}</span>
                      </span>
                    </button>
                  `;
                })
                .join("")}
            </div>
          </div>
        `;
      })
      .filter(Boolean)
      .join("");

    const pickerContent = `${providerGroupsHtml}${externalGroupHtml}`;
    const hintText = formatGroupPickerHint(
      eligibleCount,
      ineligibleCount,
      gModal.selectedMembers.length,
      Boolean(pickerContent)
    );

    return `
      <div class="${modalOverlayClass()}" role="dialog" aria-modal="true">
        <div class="modal-card group-modal-card">
          <div class="modal-title">${editing ? `Edit "${escapeHtml(gModal.group!.name)}"` : "Create Group Chat"}</div>
          <input id="modal-group-name-input" class="modal-input" maxlength="32" placeholder="Group name (e.g. Product Brainstorm)" aria-label="Group name" value="${escapeHtml(gModal.nameDraft)}" ${saving ? "disabled" : ""} />
          <div class="group-picker-head-row">
            <div class="modal-desc">Select web accounts or API / CLI members to join this group chat</div>
            <button id="open-external-agents-from-group-btn" class="mini-btn primary-text" type="button" ${saving ? "disabled" : ""}>+ Manage API/CLI</button>
          </div>
          <div class="group-member-picker">
            ${pickerContent || `<div class="group-picker-empty">No members available yet. Sign in to a web account or add an API / CLI member in the top right.</div>`}
          </div>
          <div id="modal-group-hint" class="modal-hint">${escapeHtml(hintText)}</div>
          ${gModal.error ? `<div id="modal-error-box" class="update-error-box" role="alert">${escapeHtml(gModal.error)}</div>` : ""}
          <div class="modal-footer">
            <button id="modal-cancel-btn" class="btn" type="button" ${saving ? "disabled" : ""}>Cancel</button>
            <button id="modal-confirm-btn" class="btn primary" type="button" ${saving || gModal.selectedMembers.length === 0 ? "disabled" : ""}>${saving ? (editing ? "Saving..." : "Creating...") : (editing ? "Save" : "Create Group")}</button>
          </div>
        </div>
      </div>
    `;
  }
  if (modal.kind === "group-knowledge") {
    const kModal = modal;
    const saving = Boolean(kModal.saving);
    const enabledCount = kModal.skillsDraft.filter((s) => s.enabled).length;
    const latestGroup = state.groupChats.find((g) => g.id === kModal.group.id) ?? kModal.group;

    let tabBody = "";
    if (kModal.tab === "context") {
      tabBody = `
        <div class="modal-desc">Mentioned members automatically sync this context on first entry or after updates; API / CLI members include it on every turn.</div>
        <textarea
          id="modal-group-context-input"
          class="modal-textarea"
          rows="8"
          maxlength="8000"
          placeholder="Example: Stack is TypeScript + Vite; key constraint is low memory; currently investigating..."
          ${saving ? "disabled" : ""}
        >${escapeHtml(kModal.contextDraft)}</textarea>
        <div class="modal-hint"><span id="modal-group-context-count">${kModal.contextDraft.length}</span>/8000 chars · You can also pin messages or click "Save Round Summary" above</div>
      `;
    } else if (kModal.tab === "skills") {
      const presetsHtml = GROUP_SKILL_PRESETS.map((p, idx) => {
        const added = kModal.skillsDraft.some((s) => s.name === p.name);
        return `<button class="skill-preset-chip" data-add-skill-preset="${idx}" type="button" ${saving || added ? "disabled" : ""}>${added ? `✓ ${escapeHtml(p.name)}` : `+ ${escapeHtml(p.name)}`}</button>`;
      }).join("");

      const skillsHtml =
        kModal.skillsDraft.length === 0
          ? `<div class="group-picker-empty">No shared skills added yet. Choose a preset above or add a custom skill below.</div>`
          : kModal.skillsDraft
              .map(
                (s) => `
              <div class="skill-card ${s.enabled ? "" : "disabled"}">
                <div class="skill-card-head">
                  <label class="skill-toggle-label">
                    <input type="checkbox" data-toggle-skill-id="${escapeHtml(s.id)}" ${s.enabled ? "checked" : ""} ${saving ? "disabled" : ""} />
                    <span class="skill-card-name">${escapeHtml(s.name)}</span>
                  </label>
                  <div class="skill-card-ops">
                    <button class="mini-btn" data-edit-skill-id="${escapeHtml(s.id)}" type="button" ${saving ? "disabled" : ""}>Edit</button>
                    <button class="mini-btn danger-text" data-delete-skill-id="${escapeHtml(s.id)}" type="button" ${saving ? "disabled" : ""}>Delete</button>
                  </div>
                </div>
                <div class="skill-card-desc">${escapeHtml(s.description || s.content)}</div>
              </div>
            `
              )
              .join("");

      tabBody = `
        <div class="skill-presets-row">
          <span class="skill-presets-label">Presets:</span>
          ${presetsHtml}
        </div>
        <div class="skills-list">${skillsHtml}</div>
        <div class="skill-editor-box">
          <div class="skill-editor-title">${kModal.editingSkillId ? "Edit Shared Skill" : "Add Custom Skill"}</div>
          <input id="modal-skill-name-input" class="modal-input" maxlength="48" placeholder="Skill name (e.g. Code Review Guidelines)" value="${escapeHtml(kModal.skillNameDraft)}" ${saving ? "disabled" : ""} />
          <input id="modal-skill-desc-input" class="modal-input" maxlength="120" placeholder="Short description (optional)" value="${escapeHtml(kModal.skillDescDraft)}" ${saving ? "disabled" : ""} />
          <textarea id="modal-skill-content-input" class="modal-textarea" rows="3" maxlength="2000" placeholder="Enter skill instructions to inject into each AI member..." ${saving ? "disabled" : ""}>${escapeHtml(kModal.skillContentDraft)}</textarea>
          <div class="skill-editor-actions">
            ${kModal.editingSkillId ? `<button id="modal-skill-cancel-edit-btn" class="mini-btn" type="button" ${saving ? "disabled" : ""}>Cancel Edit</button>` : ""}
            <button id="modal-skill-save-btn" class="mini-btn primary-text" type="button" ${saving ? "disabled" : ""}>${kModal.editingSkillId ? "Update Skill" : "+ Add Skill"}</button>
          </div>
        </div>
      `;
    } else if (kModal.tab === "roles") {
      const roleRowsHtml = latestGroup.members
        .map((m) => {
          const meta = resolveMemberMeta(state, m);
          const curRole =
            kModal.rolesDraft.find((r) => sameAccountKey(r.member, m))?.role ?? "";
          const binding = !meta.isExternal
            ? (latestGroup.threadBindings ?? []).find((tb) => sameAccountKey(tb.member, m))
            : undefined;
          let boundShort = "";
          if (binding) {
            try {
              const u = new URL(binding.threadUrl);
              boundShort = `${u.hostname}${u.pathname}`;
            } catch {
              boundShort = binding.threadUrl;
            }
          }
          const bindingHtml = meta.isExternal
            ? `<div class="role-thread-row"><span class="thread-stateless-tag">Stateless direct connection (carries full context every turn)</span></div>`
            : binding
              ? `
                <div class="role-thread-row">
                  <span class="thread-bound-pill" title="${escapeHtml(binding.threadUrl)}">Bound to dedicated thread · ${escapeHtml(boundShort)}</span>
                  <button class="mini-btn" data-reset-thread-provider="${escapeHtml(m.providerId)}" data-reset-thread-uuid="${escapeHtml(m.uuid)}" type="button" ${saving ? "disabled" : ""}>Reset Thread</button>
                </div>
              `
              : `<div class="role-thread-row"><span class="thread-unbound-tag">Creates a dedicated thread automatically on first message (keeps regular chats clean)</span></div>`;

          return `
            <div class="role-row">
              <div class="role-member-meta">
                ${renderMemberAvatarNode(state, meta.acc, meta.alias, "mini", meta.ext?.kind)}
                <span class="role-member-name">${escapeHtml(meta.alias)}</span>
                <span class="group-provider-tag">${escapeHtml(meta.providerShort)}</span>
              </div>
              <input
                class="modal-input role-input"
                maxlength="120"
                data-role-provider="${escapeHtml(m.providerId)}"
                data-role-uuid="${escapeHtml(m.uuid)}"
                placeholder="Member role (e.g. Frontend performance & UX review)"
                value="${escapeHtml(curRole)}"
                ${saving ? "disabled" : ""}
              />
              ${bindingHtml}
            </div>
          `;
        })
        .join("");

      tabBody = `
        <div class="modal-desc">Configure custom role instructions per member and view or reset dedicated thread URLs for web accounts.</div>
        <div class="role-list">${roleRowsHtml || `<div class="group-picker-empty">No members</div>`}</div>
      `;
    } else {
      const snap = kModal.adaptersSnap;
      const chipsHtml = (snap?.adapters ?? [])
        .map(
          (a) =>
            `<span class="adapter-chip" title="${escapeHtml(a.hostPatterns.join(", "))}">${escapeHtml(a.name)} (${escapeHtml(a.id)})</span>`
        )
        .join("");
      tabBody = `
        <div class="modal-desc">Declarative site adapters (built-in Muse / Hark rules with hot-reloadable selector overrides) working alongside read-only Fetch/SSE hooks.</div>
        <div class="adapter-chip-row">${chipsHtml || `<span class="modal-hint">Loading rules...</span>`}</div>
        <div class="modal-hint">Override file (applied live on save without recompiling): <code>${escapeHtml(snap?.overridePath ?? "site_adapters.json")}</code></div>
        <textarea
          id="modal-adapters-json-input"
          class="modal-textarea code"
          rows="7"
          placeholder='Optional: enter a JSON array to override built-in rules, e.g. [{"id":"muse","name":"Muse","hostPatterns":["muse.ai"],"composerSelectors":["textarea"]}]'
          ${saving ? "disabled" : ""}
        >${escapeHtml(kModal.adaptersJsonDraft)}</textarea>
        <div class="skill-editor-actions">
          <button id="modal-adapters-reset-btn" class="mini-btn" type="button" ${saving || !snap?.hasOverrides ? "disabled" : ""}>Restore Built-in Defaults</button>
        </div>
      `;
    }

    const confirmLabel =
      kModal.tab === "adapters"
        ? saving ? "Saving..." : "Save & Apply Live"
        : saving ? "Saving..." : "Save Config";

    return `
      <div class="${modalOverlayClass()}" role="dialog" aria-modal="true">
        <div class="modal-card group-knowledge-modal-card">
          <div class="modal-title">Shared Context & Skills · ${escapeHtml(latestGroup.name)}</div>
          <div class="knowledge-tabs">
            <button class="knowledge-tab ${kModal.tab === "context" ? "active" : ""}" data-knowledge-tab="context" type="button" ${saving ? "disabled" : ""}>Shared Context</button>
            <button class="knowledge-tab ${kModal.tab === "skills" ? "active" : ""}" data-knowledge-tab="skills" type="button" ${saving ? "disabled" : ""}>Shared Skills (${enabledCount})</button>
            <button class="knowledge-tab ${kModal.tab === "roles" ? "active" : ""}" data-knowledge-tab="roles" type="button" ${saving ? "disabled" : ""}>Roles &amp; Threads</button>
            <button class="knowledge-tab ${kModal.tab === "adapters" ? "active" : ""}" data-knowledge-tab="adapters" type="button" ${saving ? "disabled" : ""}>Site Rules${kModal.adaptersSnap?.hasOverrides ? " *" : ""}</button>
          </div>
          ${tabBody}
          ${kModal.error ? `<div id="modal-error-box" class="update-error-box" role="alert">${escapeHtml(kModal.error)}</div>` : ""}
          <div class="modal-footer">
            <button id="modal-cancel-btn" class="btn" type="button" ${saving ? "disabled" : ""}>Cancel</button>
            <button id="modal-confirm-btn" class="btn primary" type="button" ${saving ? "disabled" : ""}>${confirmLabel}</button>
          </div>
        </div>
      </div>
    `;
  }
  if (modal.kind === "external-agents") {
    const eModal = modal;
    const saving = Boolean(eModal.saving);
    const agents = state.externalAgents ?? [];
    const presetsHtml = EXTERNAL_AGENT_PRESETS.map(
      (p, idx) =>
        `<button class="skill-preset-chip" data-ext-preset-idx="${idx}" type="button" ${saving ? "disabled" : ""}>+ ${escapeHtml(p.label)}</button>`
    ).join("");
    const listHtml =
      agents.length === 0
        ? `<div class="group-picker-empty">No API or local CLI members configured yet. Pick a preset below or add one manually.</div>`
        : agents
            .map((ext) => {
              const desc =
                ext.kind === "openai_api"
                  ? `${ext.model} · ${ext.baseUrl}`
                  : `${ext.command} ${ext.args.join(" ")}`.trim();
              return `
                <div class="ext-agent-card">
                  <div class="ext-agent-main">
                    ${renderMemberAvatarNode(state, undefined, ext.name, "mini", ext.kind)}
                    <div class="ext-agent-meta">
                      <div class="ext-agent-name">${escapeHtml(ext.name)}</div>
                      <div class="ext-agent-sub">${escapeHtml(desc)}</div>
                    </div>
                  </div>
                  <div class="skill-card-ops">
                    <button class="mini-btn" data-edit-ext-id="${escapeHtml(ext.id)}" type="button" ${saving ? "disabled" : ""}>Edit</button>
                    <button class="mini-btn danger-text" data-delete-ext-id="${escapeHtml(ext.id)}" type="button" ${saving ? "disabled" : ""}>Delete</button>
                  </div>
                </div>
              `;
            })
            .join("");

    const fieldsHtml =
      eModal.formKind === "openai_api"
        ? `
          <input id="ext-agent-url-input" class="modal-input" maxlength="260" placeholder="Base URL (e.g. https://api.deepseek.com/v1 or http://127.0.0.1:11434/v1)" value="${escapeHtml(eModal.baseUrlDraft)}" ${saving ? "disabled" : ""} />
          <input id="ext-agent-key-input" class="modal-input" maxlength="512" type="password" placeholder="API Key (optional for local Ollama)" value="${escapeHtml(eModal.apiKeyDraft)}" ${saving ? "disabled" : ""} />
          <input id="ext-agent-model-input" class="modal-input" maxlength="120" placeholder="Model name (e.g. gpt-4o / deepseek-chat / qwen2.5:14b)" value="${escapeHtml(eModal.modelDraft)}" ${saving ? "disabled" : ""} />
        `
        : `
          <input id="ext-agent-cmd-input" class="modal-input" maxlength="260" placeholder="CLI command (e.g. claude / codex / gemini)" value="${escapeHtml(eModal.commandDraft)}" ${saving ? "disabled" : ""} />
          <input id="ext-agent-args-input" class="modal-input" maxlength="400" placeholder="Space-separated args (e.g. -p or exec {prompt}; defaults to stdin without {prompt})" value="${escapeHtml(eModal.argsDraft)}" ${saving ? "disabled" : ""} />
          <input id="ext-agent-workdir-input" class="modal-input" maxlength="260" placeholder="Working directory (optional, e.g. /Users/name/project)" value="${escapeHtml(eModal.workdirDraft)}" ${saving ? "disabled" : ""} />
        `;

    return `
      <div class="${modalOverlayClass()}" role="dialog" aria-modal="true">
        <div class="modal-card group-knowledge-modal-card">
          <div class="modal-title">API / Local CLI Members</div>
          <div class="modal-desc">Configure OpenAI-compatible APIs or local CLI agents (such as Claude Code or Codex) to collaborate alongside web accounts in any group chat.</div>
          <div class="ext-agent-list">${listHtml}</div>
          <div class="skill-presets-row">
            <span class="skill-presets-label">Quick fill:</span>
            ${presetsHtml}
          </div>
          <div class="skill-editor-box">
            <div class="ext-form-head">
              <span class="skill-editor-title">${eModal.editingId ? "Edit Member" : "Add Direct Member"}</span>
              <div class="ext-kind-switch">
                <button class="mini-btn ${eModal.formKind === "openai_api" ? "primary-text" : ""}" data-ext-kind="openai_api" type="button" ${saving ? "disabled" : ""}>OpenAI API</button>
                <button class="mini-btn ${eModal.formKind === "local_cli" ? "primary-text" : ""}" data-ext-kind="local_cli" type="button" ${saving ? "disabled" : ""}>Local CLI</button>
              </div>
            </div>
            <input id="ext-agent-name-input" class="modal-input" maxlength="40" placeholder="Group display name (e.g. Claude-Code / DeepSeek)" value="${escapeHtml(eModal.nameDraft)}" ${saving ? "disabled" : ""} />
            ${fieldsHtml}
            <div class="skill-editor-actions">
              ${eModal.editingId ? `<button id="ext-agent-cancel-edit-btn" class="mini-btn" type="button" ${saving ? "disabled" : ""}>Cancel Edit</button>` : ""}
              <button id="ext-agent-save-btn" class="mini-btn primary-text" type="button" ${saving ? "disabled" : ""}>${saving ? "Saving..." : eModal.editingId ? "Update Member" : "+ Save Member"}</button>
            </div>
          </div>
          ${eModal.error ? `<div id="modal-error-box" class="update-error-box" role="alert">${escapeHtml(eModal.error)}</div>` : ""}
          <div class="modal-footer">
            <button id="modal-cancel-btn" class="btn primary" type="button" ${saving ? "disabled" : ""}>Done</button>
          </div>
        </div>
      </div>
    `;
  }
  if (modal.kind === "delete-group") {
    return `
      <div class="${modalOverlayClass()}" role="dialog" aria-modal="true">
        <div class="modal-card">
          <div class="modal-title">Delete Group "${escapeHtml(modal.group.name)}"</div>
          <div class="modal-desc">Removes this group chat and its local message history. Member accounts and native web histories are unaffected.</div>
          <div class="modal-footer">
            <button id="modal-cancel-btn" class="btn" type="button">Cancel</button>
            <button id="modal-confirm-btn" class="btn danger" type="button">Delete</button>
          </div>
        </div>
      </div>
    `;
  }
  return `
    <div class="${modalOverlayClass()}" role="dialog" aria-modal="true">
      <div class="modal-card">
        <div class="modal-title">Remove "${escapeHtml(modal.account.alias)}"</div>
        <div class="modal-desc">Closes this view and removes its isolated local browsing profile (cookies and storage). Cloud accounts and remote chat history remain intact.</div>
        <div class="modal-footer">
          <button id="modal-cancel-btn" class="btn" type="button">Cancel</button>
          <button id="modal-confirm-btn" class="btn danger" type="button">Remove</button>
        </div>
      </div>
    </div>
  `;
}

function renderMiddleContent(state: ManagerSnapshot, provider: ProviderInfo): string {
  const providerAccounts = state.accounts.filter((a) => a.providerId === provider.id);
  const switchingKey = effectiveSwitchingKey(state);
  const isMobile = isMobilePlatform(state.platform);
  const supportsProxy = supportsAccountProxy(state.platform);
  const supportsCookieCopy = supportsProxy || isMobile;
  const canReorder = providerAccounts.length > 1 && state.conflicts.length === 0;

  const noticeHtml = state.notice
    ? `
      <div class="notice-bar">
        <span>${escapeHtml(state.notice)}</span>
        <button id="dismiss-notice-btn" class="notice-close" type="button" title="Dismiss notice">✕</button>
      </div>
    `
    : "";

  const conflictsHtml = state.conflicts
    .map(
      (c) => `
      <div class="conflict-box">
        <div>UUID ownership conflict detected (${escapeHtml(c.uuid.slice(0, 8))}…), choose the service to keep:</div>
        <div class="conflict-actions">
          ${c.providers
            .map(
              (pid) =>
                `<button class="mini-btn" data-resolve-uuid="${escapeHtml(c.uuid)}" data-resolve-provider="${escapeHtml(pid)}" type="button">Assign to ${escapeHtml(pid.toUpperCase())}</button>`
            )
            .join("")}
        </div>
      </div>
    `
    )
    .join("");

  const hasUpdate = Boolean(updateState.result?.hasUpdate);
  const mobileSyncBtn = isMobile
    ? `<button id="sync-btn" class="ghost-icon-btn" type="button" title="Multi-device encrypted sync">${ICON_SYNC}</button>`
    : "";
  const mobileThemeBtn = isMobile
    ? `<button id="theme-toggle-btn" class="ghost-icon-btn" type="button" title="Theme: ${themeLabel(themeMode)} (click to switch)">${themeIcon(themeMode)}</button>`
    : "";
  const mobileUpdateBtn = isMobile
    ? `<button id="check-update-btn" class="ghost-icon-btn update-trigger-btn ${hasUpdate ? "has-update" : ""}" type="button" title="${hasUpdate ? `New version v${escapeHtml(updateState.result!.latestVersion)}` : "Check for updates"}">${ICON_UPDATE}${hasUpdate ? `<span class="update-dot"></span>` : ""}</button>`
    : "";

  const headerBtnHtml = provider.enabled
    ? `
      ${mobileSyncBtn}
      ${mobileThemeBtn}
      ${mobileUpdateBtn}
      ${!isMobile ? `<button id="sync-all-btn" class="ghost-icon-btn" type="button" title="Refresh quota for ready accounts">${ICON_REFRESH}</button>` : ""}
      <button id="open-site-btn" class="ghost-icon-btn" type="button" title="Open ${escapeHtml(provider.shortName)} website in browser">${ICON_EXTERNAL}</button>
      <button id="add-account-btn" class="icon-btn primary" type="button">+ Add</button>
    `
    : `${mobileSyncBtn}${mobileThemeBtn}${mobileUpdateBtn}<button id="open-site-btn" class="icon-btn primary" type="button">Open Site ${ICON_EXTERNAL}</button>`;

  const listToolbarHtml =
    provider.enabled && providerAccounts.length >= 2 && state.conflicts.length === 0
      ? `
        <div class="list-toolbar">
          <button id="smart-switch-btn" class="toolbar-chip" type="button" title="Switch to the account with the highest remaining quota">
            ${ICON_BOLT}<span>Highest Quota</span>
          </button>
          <button id="sort-quota-btn" class="toolbar-chip" type="button" title="Sort by remaining available quota (high to low)">
            ${ICON_SORT}<span>Sort by Quota</span>
          </button>
        </div>
      `
      : "";

  let listBody = "";
  if (!provider.enabled) {
    listBody = `
      <div class="empty-list">
        <div class="empty-icon-circle">${renderProviderLogo(provider)}</div>
        <div><strong>${escapeHtml(provider.name)}</strong> embedded session coming soon</div>
        <div>Pending verification of official direct sign-in and embedding terms. Use the top-right button to open the website.</div>
      </div>
    `;
  } else if (providerAccounts.length === 0) {
    listBody = `
      <div class="empty-list">
        <div class="empty-icon-circle">${ICON_USER_PLUS}</div>
        <div>No ${escapeHtml(provider.shortName)} accounts yet</div>
        <div>Click "+ Add" in the top right to create an isolated sign-in session</div>
      </div>
    `;
  } else {
    listBody = providerAccounts
      .map((acc, idx) => {
        const switching = isSameKey(switchingKey, acc);
        const active = !switching && isSameKey(state.activeAccount, acc);
        const avatarText = computeAvatarText(acc);
        const isLoggedOut = acc.authState === "logged_out";
        const pageError = isLoggedOut ? null : findAccountPageError(state, acc);
        const hasPageError = Boolean(pageError);
        const hasDetail = !isLoggedOut && !hasPageError && Boolean(acc.quotaDetail);
        const cookieInfo = isLoggedOut || hasPageError ? null : formatCookieExpiry(acc);

        const quotaState =
          isLoggedOut || hasPageError
            ? { status: "normal" as QuotaStatus, label: "", extraDepleted: false }
            : resolveQuotaState(acc);
        const {
          status: alertStatus,
          label: alertLabel,
          extraDepleted,
        } = quotaState;

        const isMac = navigator.userAgent.includes("Mac");
        const shortcutHint =
          !isMobile && idx < 9
            ? `<span class="shortcut-pill" title="Quick switch shortcut">${isMac ? "⌘" : "^"}${idx + 1}</span>`
            : "";
        const proxyBadgeHtml =
          supportsProxy && acc.proxyUrl
            ? `<span class="proxy-pill" title="Proxy: ${escapeHtml(acc.proxyUrl)}">Proxy</span>`
            : "";
        const timezoneBadgeHtml = acc.timezone
          ? `<span class="proxy-pill" title="Time zone: ${escapeHtml(acc.timezone)}">${escapeHtml(acc.timezone)}</span>`
          : "";
        const alertBadgeHtml = switching
          ? `<span class="loading-status-badge">Loading…</span>`
          : isLoggedOut
            ? `<span class="auth-status-badge">Signed out</span>`
            : hasPageError
              ? `<span class="auth-status-badge error">Page error</span>`
              : alertStatus !== "normal"
                ? `<span class="quota-warning-badge ${alertStatus}">${alertLabel}</span>`
                : "";

        let compactSubHtml = "";
        if (switching && !hasDetail && !hasPageError) {
          compactSubHtml = `<div class="account-sub loading-text"><span class="quota-label-text">Loading…</span></div>`;
        } else if (isLoggedOut) {
          const loginHint = active
            ? isMobile
              ? "Session expired, tap to sign in again"
              : "Session expired, please sign in again on the right"
            : acc.autoAlias
              ? "Not signed in, click to sign in"
              : "Session expired, click to sign in again";
          compactSubHtml = `<div class="account-sub auth-logged-out"><span class="auth-dot-inline"></span><span class="quota-label-text">${loginHint}</span></div>`;
        } else if (hasPageError) {
          compactSubHtml = `<div class="account-sub auth-page-error"><span class="auth-dot-inline error"></span><span class="quota-label-text">${escapeHtml(pageError!)}</span><button class="inline-relogin-btn" data-relogin-uuid="${escapeHtml(acc.uuid)}" type="button">Reset & Sign In</button></div>`;
        } else if (!hasDetail) {
          const fallbackLabel = acc.autoAlias
            ? "Quota syncs after sign-in"
            : "Syncing quota details…";
          const quotaLabel = acc.quotaText ?? fallbackLabel;
          const isEmpty =
            acc.quotaPercent === 0 ||
            Boolean(acc.quotaText?.includes("用尽") || /exhausted|depleted/i.test(acc.quotaText ?? ""));
          const isLow =
            !isEmpty &&
            ((typeof acc.quotaPercent === "number" && acc.quotaPercent <= 20) ||
              Boolean(acc.quotaText?.includes("偏低") || /\blow\b/i.test(acc.quotaText ?? "")));
          const subClass = isEmpty
            ? "account-sub quota-empty"
            : isLow
              ? "account-sub quota-low"
              : "account-sub";
          const barHtml =
            typeof acc.quotaPercent === "number"
              ? `<span class="mini-quota-track"><span class="mini-quota-fill ${isEmpty ? "empty" : isLow ? "low" : ""}" style="width:${Math.max(0, Math.min(100, acc.quotaPercent))}%"></span></span>`
              : "";
          compactSubHtml = `<div class="${subClass}">${barHtml}<span class="quota-label-text">${escapeHtml(quotaLabel)}</span></div>`;
        }

        const rowClass = [
          "account-row",
          hasDetail ? "has-detail" : "",
          active ? "active" : "",
          switching ? "switching" : "",
          isLoggedOut ? "logged-out" : "",
          hasPageError ? "has-page-error" : "",
          alertStatus !== "normal" ? `alert-${alertStatus}` : "",
        ]
          .filter(Boolean)
          .join(" ");

        const avatarClass = [
          "avatar",
          acc.autoAlias ? "pending-identity" : acc.providerId,
        ].join(" ");

        const avatarNodeHtml = acc.avatarUrl
          ? `<div class="avatar has-photo"><img src="${escapeHtml(acc.avatarUrl)}" class="avatar-photo" alt="" draggable="false" /></div>`
          : `<div class="${avatarClass}">${escapeHtml(avatarText)}</div>`;

        const showManualAliasHint =
          !isLoggedOut &&
          !hasPageError &&
          acc.authState === "authenticated" &&
          acc.autoAlias &&
          (acc.alias === "已登录账号" || acc.alias === "Signed-in Account");

        return `
          <div class="${rowClass}" data-switch-uuid="${escapeHtml(acc.uuid)}" ${!isMobile && canReorder ? `draggable="true"` : ""}>
            <div class="account-header">
              <div class="avatar-wrap">
                ${avatarNodeHtml}
                ${switching ? `<span class="avatar-spinner"></span>` : ""}
                ${active ? `<span class="status-dot ${isLoggedOut ? "offline" : hasPageError ? "error" : ""}"></span>` : ""}
              </div>
              <div class="account-meta">
                <div class="account-alias-row">
                  <span class="account-alias">${escapeHtml(acc.alias)}</span>
                  ${shortcutHint}
                  ${proxyBadgeHtml}
                  ${timezoneBadgeHtml}
                  ${alertBadgeHtml}
                </div>
                ${showManualAliasHint ? `<div class="alias-manual-hint"><span>Email unavailable</span><button class="inline-rename-link" data-rename-uuid="${escapeHtml(acc.uuid)}" type="button">Rename manually</button></div>` : ""}
                ${compactSubHtml}
                ${!hasDetail && !isLoggedOut && !hasPageError && !switching && cookieInfo ? `<div class="cookie-expiry-line inline ${cookieInfo.tone}" title="${escapeHtml(cookieInfo.tooltip)}"><span class="cookie-expiry-dot"></span><span>${escapeHtml(cookieInfo.shortText)}</span></div>` : ""}
              </div>
              <div class="row-ops">
                ${canReorder ? `
                  <div class="reorder-stack">
                    <button class="reorder-btn" data-move-uuid="${escapeHtml(acc.uuid)}" data-move-dir="up" title="Move up" aria-label="Move up" type="button" ${idx === 0 ? "disabled" : ""}>▲</button>
                    <button class="reorder-btn" data-move-uuid="${escapeHtml(acc.uuid)}" data-move-dir="down" title="Move down" aria-label="Move down" type="button" ${idx === providerAccounts.length - 1 ? "disabled" : ""}>▼</button>
                  </div>
                ` : ""}
                ${!isMobile ? `
                  <button class="action-icon-btn ${switching ? "spinning" : ""}" data-reload-uuid="${escapeHtml(acc.uuid)}" title="Force refresh page" type="button" ${switching ? "disabled" : ""}>${ICON_REFRESH}</button>
                ` : ""}
                ${supportsCookieCopy ? `
                  <button class="action-icon-btn copy-cookie-btn" data-copy-cookie-uuid="${escapeHtml(acc.uuid)}" data-copy-label="Copy Cookie" aria-label="Copy Cookie" type="button">
                    <span class="copy-cookie-icon" aria-hidden="true"></span>
                  </button>
                ` : ""}
                <button class="action-icon-btn" data-rename-uuid="${escapeHtml(acc.uuid)}" title="Account settings" type="button">${ICON_EDIT}</button>
                <button class="action-icon-btn danger" data-remove-uuid="${escapeHtml(acc.uuid)}" title="Remove from device" type="button">${ICON_TRASH}</button>
              </div>
            </div>
            ${!isLoggedOut && !hasPageError && acc.quotaDetail ? renderQuotaDetailPanel(acc.quotaDetail, alertStatus, extraDepleted) : ""}
            ${hasDetail && cookieInfo ? `<div class="cookie-expiry-line ${cookieInfo.tone}" title="${escapeHtml(cookieInfo.tooltip)}"><span class="cookie-expiry-dot"></span><span>${escapeHtml(cookieInfo.shortText)}</span></div>` : ""}
          </div>
        `;
      })
      .join("");
  }

  return `
    <div class="column-header">
      <div class="provider-title-wrap">
        <span class="provider-title">${escapeHtml(provider.name)}</span>
        ${
          !provider.enabled
            ? `<span class="status-pill">${escapeHtml(provider.statusText)}</span>`
            : providerAccounts.length > 0
              ? `<span class="count-badge">${providerAccounts.length}</span>`
              : ""
        }
      </div>
      <div class="header-actions">${headerBtnHtml}</div>
    </div>
    ${listToolbarHtml}
    ${noticeHtml}
    ${conflictsHtml}
    <div class="account-list">${listBody}</div>
    ${renderDownloadToast()}
    ${renderModal(state, provider)}
  `;
}

function renderDownloadToast(): string {
  if (!downloadToast) return "";
  const isStarted = downloadToast.status === "started";
  const isDone = downloadToast.status === "completed";
  const isFail = downloadToast.status === "failed";
  const label = isStarted
    ? `Downloading: ${downloadToast.filename}`
    : isDone
      ? `Download complete: ${downloadToast.filename}`
      : `Download failed: ${downloadToast.filename}${downloadToast.error ? ` (${downloadToast.error})` : ""}`;
  return `
    <div id="download-toast" class="download-toast ${isFail ? "error" : isDone ? "success" : ""}" role="status" aria-live="polite">
      <span class="download-toast-text" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      ${isDone ? `<button id="download-reveal-btn" class="download-toast-action" data-download-id="${downloadToast.id}" type="button">Show in Folder</button>` : ""}
      <button id="download-close-btn" class="download-toast-close" type="button" aria-label="Dismiss download notice">✕</button>
    </div>
  `;
}

function renderRightStage(state: ManagerSnapshot, provider: ProviderInfo): string {
  const switchingKey = effectiveSwitchingKey(state);
  const switchingAcc = switchingKey
    ? state.accounts.find(
        (a) => a.providerId === switchingKey.providerId && a.uuid === switchingKey.uuid
      )
    : undefined;

  if (switchingKey) {
    const targetName = switchingAcc?.alias ?? provider.shortName;
    return `
      <main class="right-placeholder">
        <div class="stage-card">
          <div class="stage-logo-orbit">
            <span class="stage-orbit-ring"></span>
            <div class="stage-logo-tile">${renderProviderLogo(provider)}</div>
          </div>
          <div class="placeholder-title">Loading "${escapeHtml(targetName)}"</div>
          <div class="placeholder-desc">Rendering ${escapeHtml(provider.shortName)} for the first time. Subsequent switches will be instant…</div>
          <div class="progress-track"><div class="progress-bar"></div></div>
        </div>
      </main>
    `;
  }

  if (!provider.enabled) {
    return `
      <main class="right-placeholder">
        <div class="stage-card">
          <div class="stage-logo-tile">${renderProviderLogo(provider)}</div>
          <div class="placeholder-title">${escapeHtml(provider.name)} · Coming Soon</div>
          <div class="placeholder-desc">Embedded sessions are not yet enabled for this provider. Opening the website will not overwrite your last active account.</div>
          <button id="stage-open-site-btn" class="btn primary" type="button">Open ${escapeHtml(provider.shortName)} Website</button>
        </div>
      </main>
    `;
  }

  if (!isTauriRuntime() && state.activeAccount) {
    const activeAcc = state.accounts.find(
      (a) =>
        a.providerId === state.activeAccount!.providerId &&
        a.uuid === state.activeAccount!.uuid
    );
    if (activeAcc) {
      const authLabel =
        activeAcc.authState === "authenticated"
          ? "Signed in"
          : activeAcc.authState === "logged_out"
            ? "Signed out"
            : "Pending sync";
      const quotaInfo = activeAcc.quotaText ? ` · Quota: ${activeAcc.quotaText}` : "";
      const tzInfo = activeAcc.timezone ? ` · Time zone: ${activeAcc.timezone}` : "";
      return `
        <main class="right-placeholder">
          <div class="stage-card">
            <div class="stage-logo-tile">${renderProviderLogo(provider)}</div>
            <div class="placeholder-title">${escapeHtml(activeAcc.alias)}</div>
            <div class="placeholder-desc">
              ${escapeHtml(provider.name)} · ${authLabel}${escapeHtml(quotaInfo)}${escapeHtml(tzInfo)}<br/>
              Web preview mode: isolated native WebView sessions run inside the Tauri desktop/mobile shell. Here you can manage accounts, import cookies, edit site adapters, and orchestrate multi-agent group chats.
            </div>
            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
              <button id="stage-account-settings-btn" class="btn" type="button">Account Settings</button>
              <button id="stage-open-site-btn" class="btn primary" type="button">Open ${escapeHtml(provider.shortName)} Website</button>
            </div>
          </div>
        </main>
      `;
    }
  }

  return `
    <main class="right-placeholder">
      <div class="stage-card">
        <div class="stage-logo-tile">${renderProviderLogo(provider)}</div>
        <div class="placeholder-title">${escapeHtml(provider.name)}</div>
        <div class="placeholder-desc">Select an account on the left to open its session, or add a new account for an isolated sign-in environment.</div>
        <button id="stage-add-btn" class="btn primary" type="button">+ Add ${escapeHtml(provider.shortName)} Account</button>
      </div>
    </main>
  `;
}

async function openCreateGroupModal(state: ManagerSnapshot): Promise<void> {
  await setModal({
    kind: "group",
    nameDraft: `Group Chat ${state.groupChats.length + 1}`,
    selectedMembers: [],
  });
}

async function openEditGroupModal(group: GroupChatRecord): Promise<void> {
  await setModal({
    kind: "group",
    group,
    nameDraft: group.name,
    selectedMembers: group.members.map((m) => ({ providerId: m.providerId, uuid: m.uuid })),
  });
}

async function openGroupKnowledgeModal(
  group: GroupChatRecord,
  tab: "context" | "skills" | "roles" | "adapters" = "context"
): Promise<void> {
  await setModal({
    kind: "group-knowledge",
    group,
    tab,
    contextDraft: group.sharedContext ?? "",
    skillsDraft: (group.sharedSkills ?? []).map((s) => ({ ...s })),
    rolesDraft: (group.memberRoles ?? []).map((r) => ({
      member: { ...r.member },
      role: r.role,
    })),
    skillNameDraft: "",
    skillDescDraft: "",
    skillContentDraft: "",
    editingSkillId: null,
    adaptersSnap: null,
    adaptersJsonDraft: "",
    adaptersLoaded: false,
  });
}

async function openExternalAgentsModal(editAgent?: ExternalAgentRecord): Promise<void> {
  await setModal({
    kind: "external-agents",
    editingId: editAgent?.id ?? null,
    formKind: editAgent?.kind ?? "openai_api",
    nameDraft: editAgent?.name ?? "",
    baseUrlDraft: editAgent?.baseUrl ?? "",
    apiKeyDraft: editAgent?.apiKey ?? "",
    modelDraft: editAgent?.model ?? "",
    commandDraft: editAgent?.command ?? "",
    argsDraft: editAgent ? editAgent.args.join(" ") : "",
    workdirDraft: editAgent?.workdir ?? "",
  });
}

function isAsciiWordChar(ch: string | undefined): boolean {
  return Boolean(ch && /^[A-Za-z0-9_]$/.test(ch));
}

const ALL_MENTION_KEYWORDS = ["all", "everyone", "全体成员", "所有人", "全体"];

function scanTextMentions<T extends { alias: string }>(
  text: string,
  members: T[]
): Array<{ start: number; end: number; isAll: boolean; member?: T }> {
  const sorted = [...members]
    .filter((m) => m.alias.trim().length > 0)
    .sort((a, b) => b.alias.length - a.alias.length);
  const hits: Array<{ start: number; end: number; isAll: boolean; member?: T }> = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "@" || (i > 0 && isAsciiWordChar(text[i - 1]))) {
      i += 1;
      continue;
    }
    const rest = text.slice(i + 1);
    const restLower = rest.toLowerCase();
    let matched = false;
    for (const kw of ALL_MENTION_KEYWORDS) {
      if (restLower.startsWith(kw)) {
        const after = rest[kw.length];
        if (!isAsciiWordChar(after)) {
          hits.push({ start: i, end: i + 1 + kw.length, isAll: true });
          i += 1 + kw.length;
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;
    for (const m of sorted) {
      const alias = m.alias;
      if (restLower.startsWith(alias.toLowerCase())) {
        const after = rest[alias.length];
        const lastAliasChar = alias[alias.length - 1];
        if (!(isAsciiWordChar(lastAliasChar) && isAsciiWordChar(after))) {
          hits.push({ start: i, end: i + 1 + alias.length, isAll: false, member: m });
          i += 1 + alias.length;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      i += 1;
    }
  }
  return hits;
}

function extractComposerAtMentions(
  text: string,
  members: Array<{ key: AccountKey; alias: string }>
): { hasMention: boolean; isAll: boolean; targets: AccountKey[]; labels: string[] } {
  const hits = scanTextMentions(text, members);
  if (hits.length === 0) {
    return { hasMention: false, isAll: false, targets: [], labels: [] };
  }
  if (hits.some((h) => h.isAll)) {
    return { hasMention: true, isAll: true, targets: [], labels: ["All members"] };
  }
  const targets: AccountKey[] = [];
  const labels: string[] = [];
  for (const h of hits) {
    if (h.member && !targets.some((t) => sameAccountKey(t, h.member!.key))) {
      targets.push(h.member.key);
      labels.push(h.member.alias);
    }
  }
  return { hasMention: targets.length > 0, isAll: false, targets, labels };
}

function renderMessageTextWithMentions(content: string, memberAliases: string[]): string {
  const hits = scanTextMentions(
    content,
    memberAliases.map((alias) => ({ alias }))
  );
  if (hits.length === 0) {
    return escapeHtml(content);
  }
  let out = "";
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) {
      out += escapeHtml(content.slice(cursor, hit.start));
    }
    out += `<span class="group-mention-tag">${escapeHtml(content.slice(hit.start, hit.end))}</span>`;
    cursor = hit.end;
  }
  if (cursor < content.length) {
    out += escapeHtml(content.slice(cursor));
  }
  return out;
}

function formatReviewStageChain(labels: string[]): string {
  if (labels.length < 2) return "";
  return labels
    .map((label, idx) => {
      const stage =
        idx === 0
          ? "Draft"
          : idx === labels.length - 1 && labels.length >= 3
            ? "Final Synthesis"
            : "Cross-Review";
      return `${label} (${stage})`;
    })
    .join(" → ");
}

function formatComposerHintText(
  draft: string,
  selectedTargets: AccountKey[],
  members: Array<{ key: AccountKey; alias: string; categoryId: string }>,
  workflowMode: GroupWorkflowMode = "parallel",
  maxRelayHops = 2,
  selectedAutoChannels: Array<{ id: string; label: string }> = []
): string {
  const inline = extractComposerAtMentions(draft, members);
  const modeSuffix =
    workflowMode === "review"
      ? " · Review flow (Draft → Review → Final)"
      : workflowMode === "a2a_relay"
        ? ` · A2A relay (up to ${maxRelayHops} hops)`
        : "";
  if (inline.hasMention) {
    if (inline.isAll) {
      return `Detected @all: forwarding to all members with rate-limited queue${modeSuffix}`;
    }
    const inlineCats = new Set(
      inline.targets
        .map((tk) => members.find((m) => sameAccountKey(m.key, tk))?.categoryId)
        .filter((x): x is string => Boolean(x))
    );
    const extraAuto = selectedAutoChannels.filter((c) => !inlineCats.has(c.id));
    if (workflowMode === "review") {
      const reviewLabels = [
        ...inline.labels.map((l) => `@${l}`),
        ...extraAuto.map((c) => `${c.label} (Auto)`),
      ];
      if (reviewLabels.length >= 2) {
        return `Detected @ mention, review order: ${formatReviewStageChain(reviewLabels)}`;
      }
    }
    if (extraAuto.length > 0) {
      return `Detected @${inline.labels.join(", @")}: also forwarding to ${extraAuto
        .map((c) => `${c.label} (Auto-pick)`)
        .join(", ")}${modeSuffix}`;
    }
    return `Detected @${inline.labels.join(", @")}: forwarding only to mentioned members${modeSuffix}`;
  }
  const hasExplicit = selectedTargets.length > 0;
  const hasAuto = selectedAutoChannels.length > 0;
  if (hasExplicit || hasAuto) {
    const parts: string[] = [];
    for (const t of selectedTargets) {
      parts.push(
        `@${members.find((m) => sameAccountKey(m.key, t))?.alias ?? t.uuid.slice(0, 6)}`
      );
    }
    for (const ac of selectedAutoChannels) {
      parts.push(`${ac.label} (Auto by quota)`);
    }
    if (workflowMode === "review" && parts.length >= 2) {
      return `Review order: ${formatReviewStageChain(parts)}`;
    }
    return `Sending only to ${parts.join(", ")}${modeSuffix}`;
  }
  if (workflowMode === "review") {
    return "Review mode: runs members sequentially (Draft → Cross-Review → Final); click chips above or type @mentions in order to set sequence";
  }
  if (workflowMode === "a2a_relay") {
    return `A2A relay mode: @mentions inside member replies automatically trigger the next hop (up to ${maxRelayHops} hops)`;
  }
  return "Send to all members (type @ to mention, Enter to send, Shift+Enter for newline)";
}

function renderGroupMiddleContent(state: ManagerSnapshot, provider: ProviderInfo): string {
  const noticeHtml = state.notice
    ? `
      <div class="notice-bar">
        <span>${escapeHtml(state.notice)}</span>
        <button id="dismiss-notice-btn" class="notice-close" type="button" title="Dismiss notice">✕</button>
      </div>
    `
    : "";

  const extCount = (state.externalAgents ?? []).length;

  const listBody =
    state.groupChats.length === 0
      ? `
        <div class="empty-list">
          <div class="empty-icon-circle">${ICON_GROUP}</div>
          <div>No group chats yet</div>
          <div>Click "+ New Group" in the top right to mix web accounts and API / CLI members</div>
        </div>
      `
      : state.groupChats
          .map((g) => {
            const active = state.activeGroupId === g.id;
            const hasNeedsAuth = groupHasNeedsAuth(g);
            const isStreaming = g.messages.some(
              (m) => m.status === "queued" || m.status === "sending" || m.status === "streaming"
            );
            const lastMsg = g.messages[g.messages.length - 1];
            const lastSenderName = lastMsg
              ? resolveGroupMessageSenderName(state, lastMsg)
              : "";
            const preview = lastMsg
              ? lastMsg.status === "needs_auth"
                ? `[Auth needed] ${lastSenderName}`
                : lastMsg.role === "user"
                  ? `Me: ${lastMsg.content}`
                  : lastMsg.status === "queued"
                    ? `${lastSenderName}: Queued for reply…`
                    : lastMsg.content
                      ? `${lastSenderName}: ${lastMsg.content}`
                      : `${lastSenderName} is replying…`
              : `${g.members.length} members · Click to start chat`;

            const avatarStack = g.members
              .slice(0, 3)
              .map((m) => {
                const meta = resolveMemberMeta(state, m);
                return renderMemberAvatarNode(
                  state,
                  meta.acc,
                  meta.alias || "Member",
                  "group-mini-avatar",
                  meta.ext?.kind
                );
              })
              .join("");

            return `
              <div class="group-row ${active ? "active" : ""}" data-select-group-id="${escapeHtml(g.id)}">
                <div class="group-avatar-stack">
                  ${avatarStack || `<div class="avatar custom group-mini-avatar">G</div>`}
                </div>
                <div class="group-row-meta">
                  <div class="group-row-top">
                    <span class="account-alias">${escapeHtml(g.name)}</span>
                    <span class="group-count-pill">${g.members.length} members</span>
                    ${hasNeedsAuth ? `<span class="quota-warning-badge low">Auth needed</span>` : isStreaming ? `<span class="loading-status-badge">Replying</span>` : ""}
                  </div>
                  <div class="group-row-preview">${escapeHtml(preview)}</div>
                </div>
                <div class="row-ops">
                  <button class="action-icon-btn" data-edit-group-id="${escapeHtml(g.id)}" title="Edit members and group name" type="button">${ICON_EDIT}</button>
                  <button class="action-icon-btn danger" data-delete-group-id="${escapeHtml(g.id)}" title="Delete group chat" type="button">${ICON_TRASH}</button>
                </div>
              </div>
            `;
          })
          .join("");

  return `
    <div class="column-header">
      <div class="provider-title-wrap">
        <span class="provider-title">Group Chat</span>
        ${state.groupChats.length > 0 ? `<span class="count-badge">${state.groupChats.length}</span>` : ""}
      </div>
      <div class="header-actions">
        <button id="manage-external-agents-btn" class="icon-btn ext-header-btn" type="button" title="Manage direct OpenAI API & local CLI members">API/CLI${extCount > 0 ? ` (${extCount})` : ""}</button>
        <button id="create-group-btn" class="icon-btn primary" type="button">+ New Group</button>
      </div>
    </div>
    ${noticeHtml}
    <div class="account-list">${listBody}</div>
    ${renderDownloadToast()}
    ${renderModal(state, provider)}
  `;
}

function getLatestRoundCompletedReplies(
  state: ManagerSnapshot,
  group: GroupChatRecord
): { userText: string; replies: Array<{ speaker: string; text: string }> } | null {
  let lastUserIdx = -1;
  for (let i = group.messages.length - 1; i >= 0; i -= 1) {
    if (group.messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return null;
  const replies = group.messages
    .slice(lastUserIdx + 1)
    .filter((m) => m.role === "assistant" && m.status === "done" && m.content.trim().length > 0)
    .map((m) => ({
      speaker: resolveGroupMessageSenderName(state, m),
      text: m.content.trim(),
    }));
  if (replies.length === 0) return null;
  return { userText: group.messages[lastUserIdx].content.trim(), replies };
}

function renderGroupRightStage(state: ManagerSnapshot): string {
  const activeGroup = state.activeGroupId
    ? state.groupChats.find((g) => g.id === state.activeGroupId)
    : undefined;

  if (!activeGroup) {
    return `
      <main class="right-placeholder">
        <div class="stage-card">
          <div class="stage-logo-tile group-stage-icon">${ICON_GROUP}</div>
          <div class="placeholder-title">Create Your Cross-Provider AI Group Chat</div>
          <div class="placeholder-desc">Mix Muse / Hark web accounts with OpenAI API / local CLI agents, with Parallel, Review Flow, A2A Relay, and dedicated thread binding.</div>
          <div class="stage-card-actions">
            <button id="stage-create-group-btn" class="btn primary" type="button">+ New Group</button>
          </div>
        </div>
      </main>
    `;
  }

  const workflowMode: GroupWorkflowMode = activeGroup.workflowMode ?? "parallel";
  const maxRelayHops = activeGroup.maxRelayHops ?? 2;
  const draftVal = groupDrafts[activeGroup.id] ?? "";
  const selectedTargets = (groupTargets[activeGroup.id] ?? []).filter((t) =>
    activeGroup.members.some((m) => sameAccountKey(m, t))
  );
  const memberEntries = activeGroup.members.map((m) => {
    const meta = resolveMemberMeta(state, m);
    const isNeedsAuth = activeGroup.messages.some(
      (msg) =>
        msg.status === "needs_auth" && msg.sender && sameAccountKey(msg.sender, m)
    );
    const isBusy = activeGroup.messages.some(
      (msg) =>
        (msg.status === "queued" || msg.status === "sending" || msg.status === "streaming") &&
        msg.sender &&
        sameAccountKey(msg.sender, m)
    );
    const hasBinding = !meta.isExternal && Boolean(
      (activeGroup.threadBindings ?? []).some((tb) => sameAccountKey(tb.member, m))
    );
    return {
      key: m,
      isExternal: meta.isExternal,
      acc: meta.acc,
      ext: meta.ext,
      providerShort: meta.providerShort,
      alias: meta.alias,
      loggedOut: meta.loggedOut,
      warm: meta.warm,
      isNeedsAuth,
      isBusy,
      hasBinding,
    };
  });

  const targetCategories = groupByMemberCategory(
    state,
    memberEntries.filter((m) => !m.loggedOut)
  );
  const explicitTargetCats = new Set(
    selectedTargets.map((t) => resolveMemberCategory(state, t).id)
  );
  const selectedAutoIds = (groupAutoChannels[activeGroup.id] ?? []).filter(
    (catId) =>
      !explicitTargetCats.has(catId) &&
      targetCategories.some((c) => c.id === catId && c.items.length >= 2)
  );
  if ((groupAutoChannels[activeGroup.id] ?? []).length !== selectedAutoIds.length) {
    groupAutoChannels[activeGroup.id] = selectedAutoIds;
  }
  const selectedAutoChannels = selectedAutoIds
    .map((id) => {
      const cat = targetCategories.find((c) => c.id === id);
      return cat ? { id: cat.id, label: cat.label } : null;
    })
    .filter((x): x is { id: string; label: string } => Boolean(x));

  const memberAliases = memberEntries.map((m) => m.alias);
  const composerMembers = memberEntries.map((m) => ({
    key: m.key,
    alias: m.alias,
    categoryId: resolveMemberCategory(state, m.key).id,
  }));
  const targetHint = formatComposerHintText(
    draftVal,
    selectedTargets,
    composerMembers,
    workflowMode,
    maxRelayHops,
    selectedAutoChannels
  );
  const knowledgeCount =
    (activeGroup.sharedContext?.trim() ? 1 : 0) +
    (activeGroup.sharedSkills ?? []).filter((s) => s.enabled).length;
  const canPinRound = Boolean(getLatestRoundCompletedReplies(state, activeGroup));

  const msgsHtml =
    activeGroup.messages.length === 0
      ? `
        <div class="group-empty-chat">
          <div class="group-empty-title">Group Chat Ready</div>
          <div class="group-empty-desc">Switch between Parallel, Review Flow, or A2A Relay below; type @ to fuzzy-mention members. Web accounts bind automatically to dedicated threads.</div>
        </div>
      `
      : activeGroup.messages
          .map((msg: GroupChatMessage) => {
            if (msg.role === "user") {
              const targetSummary =
                msg.targets.length > 0 && msg.targets.length < activeGroup.members.length
                  ? `<div class="group-msg-targets">@${msg.targets
                      .map((t) => {
                        const meta = resolveMemberMeta(state, t);
                        return meta.alias;
                      })
                      .map(escapeHtml)
                      .join(" · @")}</div>`
                  : "";
              return `
                <div class="group-msg user">
                  <div class="group-bubble user">
                    ${targetSummary}
                    <div class="group-msg-text">${renderMessageTextWithMentions(msg.content, memberAliases)}</div>
                    <div class="group-msg-foot">${formatShortTime(msg.createdAtMs)} · Forwarded</div>
                    <div class="group-save-ctx-wrap">
                      <button class="group-pin-icon-btn" data-pin-msg-id="${escapeHtml(msg.id)}" data-tooltip="Save to shared context" aria-label="Save to shared context" type="button">${ICON_PIN}</button>
                    </div>
                  </div>
                </div>
              `;
            }

            const senderKey = msg.sender;
            const meta = senderKey ? resolveMemberMeta(state, senderKey) : null;
            const senderDisplayName = resolveGroupMessageSenderName(state, msg);
            const jumpAttrs = senderKey
              ? meta?.isExternal
                ? `data-open-ext-agent-id="${escapeHtml(senderKey.uuid)}"`
                : `data-jump-provider="${escapeHtml(senderKey.providerId)}" data-jump-uuid="${escapeHtml(senderKey.uuid)}"`
              : "";
            const statusPill =
              msg.status === "queued"
                ? `<span class="group-status-pill queued">Queued…</span>`
                : msg.status === "sending"
                  ? `<span class="group-status-pill sending">Sending…</span>`
                  : msg.status === "streaming"
                    ? `<span class="group-status-pill streaming">Replying…</span>`
                    : msg.status === "needs_auth"
                      ? `<span class="group-status-pill warn">Auth pending</span>`
                      : msg.status === "error"
                        ? `<span class="group-status-pill err">Incomplete</span>`
                        : "";
            const stagePill = msg.stageLabel
              ? `<span class="group-stage-pill">${escapeHtml(msg.stageLabel)}</span>`
              : "";

            const bodyContent = msg.content.trim()
              ? `<div class="group-msg-text">${renderMessageTextWithMentions(msg.content, memberAliases)}</div>`
              : msg.status === "queued"
                ? `<div class="group-msg-pending">Waiting for previous stage or an available slot…</div>`
                : msg.status === "sending" || msg.status === "streaming"
                  ? `<div class="group-msg-pending">${meta?.isExternal ? "Executing direct connection and streaming reply…" : "Generating reply in native account conversation…"}</div>`
                  : "";

            const canSyncReply = Boolean(
              senderKey &&
                !meta?.isExternal &&
                msg.status !== "queued" &&
                msg.status !== "sending" &&
                msg.status !== "streaming"
            );
            const isSyncing = syncingMsgIds.has(msg.id);
            const syncBtnHtml = canSyncReply
              ? `<button class="group-pin-icon-btn ${isSyncing ? "is-spinning" : ""}" data-sync-msg-id="${escapeHtml(msg.id)}" data-tooltip="Sync latest reply (no resend)" aria-label="Sync latest reply" type="button" ${isSyncing ? "disabled" : ""}>${ICON_REFRESH}</button>`
              : "";
            const pinBtnHtml = msg.content.trim()
              ? `<button class="group-pin-icon-btn" data-pin-msg-id="${escapeHtml(msg.id)}" data-tooltip="Save to shared context" aria-label="Save to shared context" type="button">${ICON_PIN}</button>`
              : "";
            const pinHoverAction =
              syncBtnHtml || pinBtnHtml
                ? `<div class="group-save-ctx-wrap ${isSyncing ? "is-active" : ""}">${syncBtnHtml}${pinBtnHtml}</div>`
                : "";

            const authCard =
              msg.status === "needs_auth"
                ? `
                  <div class="group-auth-card">
                    <span>${escapeHtml(msg.error || "Security authorization dialog detected. Switch to this account to confirm, then retry.")}</span>
                    <div class="group-error-ops">
                      <button class="mini-btn primary-text" data-retry-msg-id="${escapeHtml(msg.id)}" type="button">Retry</button>
                      ${canSyncReply ? `<button class="mini-btn" data-sync-msg-id="${escapeHtml(msg.id)}" type="button" ${isSyncing ? "disabled" : ""}>${isSyncing ? "Syncing…" : "Sync Reply"}</button>` : ""}
                      ${senderKey ? `<button class="mini-btn warn-btn" type="button" ${jumpAttrs}>Authorize Account →</button>` : ""}
                    </div>
                  </div>
                `
                : msg.status === "error" && msg.error
                  ? `
                    <div class="group-error-box">
                      <span>${escapeHtml(msg.error)}</span>
                      <div class="group-error-ops">
                        <button class="mini-btn primary-text" data-retry-msg-id="${escapeHtml(msg.id)}" type="button">Retry</button>
                        ${canSyncReply ? `<button class="mini-btn" data-sync-msg-id="${escapeHtml(msg.id)}" type="button" ${isSyncing ? "disabled" : ""}>${isSyncing ? "Syncing…" : "Sync Reply"}</button>` : ""}
                        ${senderKey ? `<button class="mini-btn" type="button" ${jumpAttrs}>${meta?.isExternal ? "Check Config" : "Inspect"}</button>` : ""}
                      </div>
                    </div>
                  `
                  : "";

            return `
              <div class="group-msg assistant">
                <button class="group-msg-avatar-btn" type="button" title="${meta?.isExternal ? `Click to edit "${escapeHtml(senderDisplayName)}" settings` : `Click to switch to "${escapeHtml(senderDisplayName)}" native conversation`}" ${jumpAttrs}>
                  ${renderMemberAvatarNode(state, meta?.acc, senderDisplayName, "", meta?.ext?.kind)}
                </button>
                <div class="group-msg-col">
                  <div class="group-msg-head">
                    <span class="group-msg-name">${escapeHtml(senderDisplayName)}</span>
                    ${meta ? `<span class="group-provider-tag">${escapeHtml(meta.providerShort)}</span>` : ""}
                    ${msg.autoRoutedChannel ? `<span class="group-auto-pill" title="Auto-selected by remaining quota">Auto-picked</span>` : ""}
                    ${stagePill}
                    <span class="group-msg-time">${formatShortTime(msg.createdAtMs)}</span>
                    ${statusPill}
                  </div>
                  <div class="group-bubble assistant ${msg.status === "needs_auth" ? "needs-auth" : msg.status === "error" ? "has-error" : ""}">
                    ${bodyContent}
                    ${authCard}
                    ${pinHoverAction}
                  </div>
                </div>
              </div>
            `;
          })
          .join("");

  return `
    <main class="group-chat-stage">
      <div class="group-chat-header">
        <div class="group-header-main">
          <div class="group-header-title-row">
            <h2 class="group-chat-title">${escapeHtml(activeGroup.name)}</h2>
            <span class="count-badge">${activeGroup.members.length} members</span>
          </div>
          <div class="group-member-bar">
            ${groupByMemberCategory(state, memberEntries)
              .map(
                (cat) => `
                  <div class="member-category-group">
                    <span class="member-category-badge" title="${escapeHtml(cat.label)}" aria-label="${escapeHtml(cat.label)}">${renderCategoryIcon(state, cat)}</span>
                    ${cat.items
                      .map((m) => {
                        const chipAttrs = m.isExternal
                          ? `data-open-ext-agent-id="${escapeHtml(m.key.uuid)}"`
                          : `data-jump-provider="${escapeHtml(m.key.providerId)}" data-jump-uuid="${escapeHtml(m.key.uuid)}"`;
                        const chipTitle = m.isExternal
                          ? `Click to edit "${escapeHtml(m.alias)}" direct settings`
                          : m.hasBinding
                            ? `Bound to dedicated group thread · Click to open "${escapeHtml(m.alias)}" (${escapeHtml(cat.label)})`
                            : `Click to open "${escapeHtml(m.alias)}" (${escapeHtml(cat.label)}) native conversation`;
                        return `
                          <button
                            class="group-member-chip ${m.isNeedsAuth ? "warn" : m.isBusy ? "busy" : m.loggedOut ? "offline" : m.warm ? "warm" : ""}"
                            ${chipAttrs}
                            title="${chipTitle}"
                            type="button"
                          >
                            <span class="group-chip-dot"></span>
                            <span>${escapeHtml(m.alias)}</span>
                            ${m.hasBinding ? `<span class="group-chip-provider">Thread</span>` : ""}
                          </button>
                        `;
                      })
                      .join("")}
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
        <div class="group-header-actions">
          ${newTopicConfirmGroupId === activeGroup.id
            ? `
              <div class="new-topic-confirm">
                <span class="new-topic-confirm-label">Start new topic:</span>
                <button id="group-new-topic-keep-btn" class="btn primary" type="button" title="Clear messages and open fresh threads for web members while keeping shared context and skills">Keep Shared Context</button>
                <button id="group-new-topic-clean-btn" class="btn" type="button" title="Clear messages and shared context, and open fresh threads for web members (keeps skills and roles)">Clear All</button>
                <button id="group-new-topic-cancel-btn" class="btn" type="button">Cancel</button>
              </div>
            `
            : `
          <button id="group-new-topic-btn" class="btn" type="button" title="Clear messages and open fresh native threads for all web members">New Topic</button>
          ${canPinRound ? `<button id="group-pin-round-btn" class="btn knowledge-btn" type="button" title="Summarize completed replies from the latest round into shared context">${ICON_PIN}<span>Save Round Summary</span></button>` : ""}
          <button id="group-knowledge-btn" class="btn knowledge-btn" type="button">Shared Context &amp; Skills${knowledgeCount > 0 ? `<span class="count-badge">${knowledgeCount}</span>` : ""}</button>
          <button id="group-edit-members-btn" class="btn" type="button">Edit Members</button>
          <button id="group-clear-msgs-btn" class="btn" type="button" ${activeGroup.messages.length === 0 ? "disabled" : ""}>Clear History</button>
            `}
        </div>
      </div>
      <div class="group-messages">${msgsHtml}</div>
      <div class="group-composer">
        <div class="group-workflow-bar">
          <div class="workflow-mode-group">
            <span class="workflow-label">Mode</span>
            <button class="workflow-mode-btn ${workflowMode === "parallel" ? "active" : ""}" data-workflow-mode="parallel" type="button">Parallel</button>
            <button class="workflow-mode-btn ${workflowMode === "review" ? "active" : ""}" data-workflow-mode="review" type="button">Review Flow</button>
            <button class="workflow-mode-btn ${workflowMode === "a2a_relay" ? "active" : ""}" data-workflow-mode="a2a_relay" type="button">A2A Relay</button>
          </div>
          ${workflowMode === "a2a_relay" ? `
            <div class="workflow-hops-group">
              <span class="workflow-label">Relay Limit</span>
              <button class="workflow-hop-btn ${maxRelayHops === 1 ? "active" : ""}" data-relay-hops="1" type="button">1 hop</button>
              <button class="workflow-hop-btn ${maxRelayHops === 2 ? "active" : ""}" data-relay-hops="2" type="button">2 hops</button>
              <button class="workflow-hop-btn ${maxRelayHops === 3 ? "active" : ""}" data-relay-hops="3" type="button">3 hops</button>
            </div>
          ` : ""}
        </div>
        <div class="group-target-chips grouped">
          <button class="group-target-chip ${selectedTargets.length === 0 && selectedAutoIds.length === 0 ? "active" : ""}" data-group-target="all" type="button">All Members</button>
          ${targetCategories
            .map((cat) => {
              const allCatSelected =
                cat.items.length > 0 &&
                cat.items.every((m) => selectedTargets.some((t) => sameAccountKey(t, m.key)));
              const isAutoActive = selectedAutoIds.includes(cat.id);
              const autoBtnHtml =
                cat.items.length >= 2
                  ? `<button
                      class="group-target-chip target-auto-chip ${isAutoActive ? "active" : ""}"
                      data-group-target-auto="${escapeHtml(cat.id)}"
                      title="Auto-rotate ${escapeHtml(cat.label)} accounts by remaining quota (mutually exclusive with explicit @mentions in this provider)"
                      type="button"
                    >Auto</button>`
                  : "";
              return `
                <div class="target-category-group">
                  <button
                    class="target-category-badge ${allCatSelected || isAutoActive ? "active" : ""}"
                    data-group-target-cat="${escapeHtml(cat.id)}"
                    title="${escapeHtml(cat.label)} · Click to toggle all members in this category"
                    aria-label="${escapeHtml(cat.label)}"
                    type="button"
                  >${renderCategoryIcon(state, cat)}</button>
                  <div class="target-category-items">
                    ${autoBtnHtml}
                    ${cat.items
                      .map((m) => {
                        const selectedIdx = selectedTargets.findIndex((t) =>
                          sameAccountKey(t, m.key)
                        );
                        const activeTarget = selectedIdx >= 0;
                        const orderPrefix =
                          workflowMode === "review" && activeTarget
                            ? `${selectedIdx + 1}·`
                            : "";
                        return `
                          <button
                            class="group-target-chip ${activeTarget ? "active" : ""}"
                            data-group-target-provider="${escapeHtml(m.key.providerId)}"
                            data-group-target-uuid="${escapeHtml(m.key.uuid)}"
                            type="button"
                          >${orderPrefix}@${escapeHtml(m.alias)}</button>
                        `;
                      })
                      .join("")}
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
        <div id="group-target-hint" class="group-composer-hint">${escapeHtml(targetHint)}</div>
        <div class="group-input-wrap">
          <div id="group-mention-menu" class="group-mention-menu" hidden></div>
          <div class="group-input-row">
            <textarea
              id="group-chat-input"
              class="group-chat-input"
              rows="2"
              maxlength="4000"
              placeholder="Type a message, use @ to mention members (Enter to send, Shift+Enter for newline)"
            >${escapeHtml(draftVal)}</textarea>
            <button id="group-send-btn" class="btn primary group-send-btn" type="button" ${groupSending ? "disabled" : ""}>${groupSending ? "Sending…" : "Send"}</button>
          </div>
        </div>
      </div>
    </main>
  `;
}

// MAAM_LOCALIZATION_OVERLAY
const MAAM_LANG_KEY = "maam_ui_language";
type MaamLanguage = "en" | "id" | "zh";
let maamLanguage: MaamLanguage = (() => {
  try { const v = localStorage.getItem(MAAM_LANG_KEY); return v === "id" || v === "zh" || v === "en" ? v : "en"; }
  catch { return "en"; }
})();
const MAAM_TRANSLATIONS: Record<Exclude<MaamLanguage, "en">, Record<string, string>> = {
  "zh": {
    "Group Chat": "群聊",
    "Sync": "同步",
    "Settings": "设置",
    "Update": "更新",
    "New Ver": "新版本",
    "New Version": "新版本",
    "Coming Soon": "待接入",
    "Check for Updates": "检查更新",
    "Tray & Global Shortcut Settings": "托盘常驻与全局快捷键设置",
    "Cross-Device Encrypted Sync": "跨设备多端加密同步",
    "Multi-Account Group Chat (Desktop)": "多账号群聊（桌面端）",
    "Send": "发送",
    "Sending…": "发送中…",
    "Add Account": "添加账号",
    "Add": "添加",
    "Cancel": "取消",
    "Save": "保存",
    "Delete": "删除",
    "Rename": "重命名",
    "Accounts": "账号",
    "Proxy": "代理",
    "Time Zone": "时区",
    "Time zone": "时区",
    "Follow System": "跟随系统",
    "New York": "纽约",
    "Los Angeles": "洛杉矶",
    "London": "伦敦",
    "Tokyo": "东京",
    "Singapore": "新加坡",
    "Shanghai": "上海",
    "UTC": "UTC",
    "Dark": "深色",
    "Light": "浅色",
    "System": "跟随",
    "Appearance": "外观主题",
    "Theme": "主题",
    "General": "常规",
    "Confirm": "确认",
    "Close": "关闭",
    "Import": "导入",
    "Export": "导出",
    "Refresh": "刷新",
    "Loading…": "正在加载…",
    "Load Failed": "加载失败",
    "Signed in": "已登录",
    "Signed out": "未登录",
    "Sign in": "登录",
    "Account Manager": "账号管理",
    "Language": "语言",
    "English": "English",
    "Bahasa Indonesia": "Bahasa Indonesia",
    "Chinese (Simplified)": "简体中文",
    "Concise Output": "极致简洁输出",
    "Architecture & Risk Review": "架构与风险评审",
    "Cross-check Facts": "交叉事实核查",
    "Direct answers only—conclusions and key points without filler.": "约束各成员直接给结论和关键点，禁止寒暄和铺垫。",
    "Respond concisely; give direct conclusions, key rationale, and actionable steps without filler or pleasantries.": "直接给结论、关键依据和可执行方案，禁止客套和冗余铺垫。",
    "Review from four angles: stability, edge cases, security, and performance.": "从稳定性、边界情况、安全性和性能四个维度输出意见。",
    "When analyzing technical designs, prioritize edge cases, concurrency races, permission security, and resource usage, and clearly state trade-offs and risks.": "分析技术方案时优先检查边界情况、并发竞争、权限安全与资源占用，明确指出取舍与潜在风险。",
    "Point out flaws in prior statements or premises before adding new conclusions.": "要求先指出前序发言或前提中的漏洞，再补充新结论。",
    "If shared context or prior member replies contain contradictions, flawed assumptions, or omissions, correct them first before adding your judgment.": "若共享上下文或前序成员发言存在矛盾、假设漏洞或遗漏，请先指出修正，再给出补充判断。",
    "Local Ollama": "Ollama 本地",
    "Local CLI": "本地 CLI",
    "Exhausted": "用尽",
    "Low": "偏低",
    "Depleted": "耗尽",
    "Daily Full": "日满",
    "Monthly Full": "月满",
    "Extra Used": "用额外",
    "Reset": "重置",
    "Month": "月",
    "Extra": "额外",
    "Extra Quota": "额外额度",
    "Cookie expired": "Cookie 已过期",
    "Session only": "仅本次会话有效",
    "Session Cookie (you may need to sign in again after closing the app)": "会话级 Cookie（关闭应用后可能需重新登录）",
    "Browser session cookie with no fixed expiration time": "浏览器会话级 Cookie，未设置固定过期时间",
    "Verifying": "校验中",
    "Replacing": "正在替换",
    "Complete": "完成",
    "Awaiting Authorization": "待授权",
    "Preparing download...": "正在准备下载...",
    "Updating...": "更新中...",
    "Authorized, Continue Install": "已授权，继续安装",
    "Download IPA": "前往下载 IPA",
    "Download & Update Now": "立即下载并更新",
    "Checking...": "检查中...",
    "Check Again": "重新检查",
    "No members available. Please sign in to a web account or add an API / CLI member first.": "暂无可用成员，请先登录网页账号或添加 API / CLI 成员。",
    "Official site or self-hosted Cloudflare Worker URL (https://...)": "官网或自建 Cloudflare Worker 地址（https://...）",
    "Uploading ciphertext...": "上传密文中...",
    "Regenerate": "重新生成",
    "Generate random encrypted relay code": "生成随机加密中转码",
    "Sync passphrase (leave blank to auto-generate 6-digit PIN)": "同步口令（留空自动生成 6 位数字 PIN）",
    "Starting...": "开启中...",
    "Restart Sharing": "重新开启",
    "Start Sharing": "开启共享",
    "Relay Channel": "中转通道",
    "LAN Address": "局域网地址",
    "End-to-End Encryption": "端到端加密",
    "Sync Passcode": "同步口令",
    "Deletion Policy": "销毁策略",
    "Validity": "有效期",
    "Auto-destroy after": "后自动销毁",
    "Destroy & Stop Now": "立即销毁并停止",
    "Stop Sharing": "停止共享",
    "Enter LAN address or paste maam-sync:// sync string (supports LAN & relay codes)": "输入局域网地址或粘贴 maam-sync:// 同步串（支持局域网与中转码）",
    "End-to-end key fragment auto-filled by passcode or QR code": "口令或二维码自动填入的端到端密钥片段",
    "Pulling...": "拉取中...",
    "Pull & Merge": "拉取并合并",
    "Set encryption passphrase (at least 4 characters)": "设置加密口令（至少 4 位）",
    "Exporting...": "导出中...",
    "Export Backup": "导出备份",
    "Or paste the full .maam encrypted backup text here": "或直接在此粘贴 .maam 加密备份全文",
    "Enter the backup decryption passphrase": "输入备份时的解密口令",
    "Importing...": "导入中...",
    "Decrypt & Import": "解密并导入",
    "Default": "默认",
    "Disable": "禁用",
    "Shortcut Active": "快捷键已生效",
    "Inactive": "未激活",
    "Disabled": "已禁用",
    "5 minutes": "5 分钟",
    "15 minutes": "15 分钟",
    "30 minutes": "30 分钟",
    "Manual only": "仅手动",
    "Active": "已生效",
    "Registration Failed": "注册失败",
    "Not Enabled": "未启用",
    "CommandOrControl+Shift+M (leave blank to disable)": "CommandOrControl+Shift+M（留空禁用）",
    "Saving...": "保存中...",
    "Account Settings": "账号设置",
    "Display name (leave blank to use login email)": "备注名称（留空则自动获取登录邮箱）",
    "Display name (leave blank to keep current)": "备注名称（留空保留原备注）",
    "Display Name": "备注名称",
    "IANA time zone (e.g., America/New_York, Asia/Tokyo)": "IANA 时区（例如 America/New_York、Asia/Tokyo）",
    "Applied per account via native WebView2 API; leave blank to follow system time zone.": "通过 WebView2 原生接口按账号独立生效，留空则使用系统时区。",
    "Injected into this account's isolated page before document load (DST supported); leave blank to follow system time zone.": "文档加载前注入该账号独立页面，支持夏令时，留空则使用系统时区。",
    "Import Cookies (optional, paste after signing in via Chrome or another browser)": "导入 Cookie（可选，支持从 Chrome 等浏览器登录后粘贴）",
    "Import Cookies (paste after signing in via Chrome or another browser)": "导入 Cookie（支持从 Chrome 等浏览器登录后粘贴）",
    "Paste Cookie header (a=1; b=2), Netscape cookies.txt, or browser-exported JSON array...": "粘贴 Cookie 请求头（a=1; b=2）、Netscape cookies.txt 或浏览器导出的 JSON 数组...",
    "Import Cookies": "导入 Cookie",
    "Confirm Clear?": "确认清空？",
    "Clear Login Cache": "清空登录缓存",
    "Creating...": "创建中...",
    "Create & Open": "创建并打开",
    "Create Group Chat": "创建群聊",
    "Group name (e.g., Product Brainstorm)": "群聊名称（如：产品头脑风暴）",
    "Group Name": "群聊名称",
    "Edit Shared Skill": "编辑共享技能",
    "Add Custom Skill": "添加自定义技能",
    "Skill name (e.g., Code Review Guidelines)": "技能名称（如：代码审查规范）",
    "Short description (optional)": "简短说明（选填）",
    "Enter skill instructions to inject into all AI members…": "输入注入给各 AI 成员的技能指令原文…",
    "Update Skill": "更新技能",
    "+ Add Skill": "+ 添加技能",
    "Edit Member": "编辑成员",
    "Add Direct Member": "新增直连成员",
    "Update Member": "更新成员",
    "+ Save Member": "+ 保存成员",
    "Encrypted Multi-Device Sync": "多端加密同步",
    "Switch to the account with the most remaining quota": "切换到剩余可用额度最多的账号",
    "Sort accounts from highest to lowest remaining quota": "按剩余可用额度从高到低排序",
    "Move Up": "上移",
    "Move Down": "下移",
    "Force Reload Page": "强制刷新页面",
    "Copy Cookie": "复制 Cookie",
    "Remove from Device": "从本机移除",
    "Dismiss download notice": "关闭下载提示",
    "All Members": "全体成员",
    "Draft": "初稿",
    "Final Synthesis": "综合定稿",
    "Cross-Review": "交叉评审",
    "Members": "成员",
    "Edit group members & name": "编辑群成员与名称",
    "Delete Group Chat": "删除群聊",
    "Manage direct OpenAI API & local CLI members": "管理直连 OpenAI API 与本地 CLI 成员",
    "Save to Shared Context": "沉淀到共享上下文",
    "Sync Latest Replies (no resend)": "同步最新回复（不重发）",
    "Sync Latest Replies": "同步最新回复",
    "Keep Shared Context": "保留共享上下文",
    "Clear All": "全部清空",
    "New Topic": "新话题",
    "Clear History": "清空记录",
    "Mode": "模式",
    "Parallel": "并行",
    "Review Flow": "评审流",
    "A2A Relay": "A2A接力",
    "Relay Limit": "接力上限",
    "Replying": "回复中",
    "Copy Sync String": "复制同步串",
    "Export Encrypted Backup (.maam)": "导出加密备份（.maam）",
    "Show File Location": "打开文件位置",
    "Import & Decrypt Backup": "导入并解密备份",
    "QR Scan / LAN": "扫码 / 局域网",
    "Encrypted Backup File": "加密备份文件",
    "Desktop Settings": "桌面端设置",
    "Minimize to system tray when closing main window": "关闭主窗口时最小化到系统托盘",
    "Auto-approve permission requests (active & background accounts)": "自动审批权限请求（前台与后台保活账号）",
    "Test Connection": "测试连接",
    "Testing...": "测速中...",
    "Cancel Edit": "取消编辑",
    "No Members": "暂无成员",
    "Reading rules…": "正在读取规则…",
    "Save & Apply Live": "保存并热生效",
    "Save Config": "保存配置",
    "Open Official Site": "打开官网",
    "Top Quota": "切到余量最多",
    "Sort by Quota": "按额度排序",
    "Clear & Re-login": "清理重登",
    "Error": "状态异常",
    "Show in Folder": "在文件夹中显示",
    "No Group Chats": "暂无群聊",
    "+ Create Group": "+ 创建群聊",
    "Create Your Cross-Service AI Group Chat": "创建你的跨服务 AI 群聊",
    "Queued…": "排队中…",
    "Delivering…": "投递中…",
    "Replying…": "回复中…",
    "Awaiting Approval": "待授权确认",
    "Incomplete": "未完成",
    "Retry": "重试",
    "Package Contents": "打包内容",
    "Direct": "直连",
    "Edit": "编辑",
    "Reset Session": "重置会话",
    "Restore Defaults": "恢复内置默认",
    "Shared Context": "共享上下文",
    "Roles & Sessions": "分工 & 会话",
    "Site Rules": "站点规则",
    "Confirm Delete": "确认删除",
    "Confirm Remove": "确认移除",
    "+ Add": "+ 新增",
    "Embedded Sessions Coming Soon": "暂未开放内嵌会话",
    "Open": "打开",
    "Multi-Account Group Chat": "多账号群聊",
    "Release Page": "发布页",
    "Dismiss Notice": "关闭提示",
    "Ownership": "归属",
    "Manual Rename": "手动改名",
    "Email not detected": "未获取到邮箱",
    "Loading": "正在加载",
    "Latest": "最新",
    "Shared Skills": "共享技能",
    "Copying…": "复制中…",
    "Cookie Copied": "已复制 Cookie",
    "[User]": "[用户]",
    "Duohao": "叠号",
    "Duohao · AI Account Switcher": "叠号 · AI 助手账号切换器",
    "No accounts yet": "暂无账号",
    "Refresh ready account quotas": "刷新已就绪账号额度"
  },
  "id": {
    "Group Chat": "Obrolan grup",
    "Sync": "Sinkronisasi",
    "Settings": "Pengaturan",
    "Update": "Pembaruan",
    "New Ver": "Versi baru",
    "New Version": "Versi baru",
    "Coming Soon": "Segera hadir",
    "Check for Updates": "Periksa pembaruan",
    "Tray & Global Shortcut Settings": "Pengaturan tray dan pintasan global",
    "Cross-Device Encrypted Sync": "Sinkronisasi terenkripsi lintas perangkat",
    "Multi-Account Group Chat (Desktop)": "Obrolan grup multi-akun (desktop)",
    "Send": "Kirim",
    "Sending…": "Mengirim…",
    "Add Account": "Tambah akun",
    "Add": "Tambah",
    "Cancel": "Batal",
    "Save": "Simpan",
    "Delete": "Hapus",
    "Rename": "Ubah nama",
    "Accounts": "Akun",
    "Proxy": "Proxy",
    "Time Zone": "Zona waktu",
    "Time zone": "Zona waktu",
    "Follow System": "Ikuti Sistem",
    "New York": "New York",
    "Los Angeles": "Los Angeles",
    "London": "London",
    "Tokyo": "Tokyo",
    "Singapore": "Singapura",
    "Shanghai": "Shanghai",
    "UTC": "UTC",
    "Dark": "Gelap",
    "Light": "Terang",
    "System": "Ikuti sistem",
    "Appearance": "Tampilan",
    "Theme": "Tema",
    "General": "Umum",
    "Confirm": "Konfirmasi",
    "Close": "Tutup",
    "Import": "Impor",
    "Export": "Ekspor",
    "Refresh": "Muat ulang",
    "Loading…": "Memuat…",
    "Load Failed": "Gagal memuat",
    "Signed in": "Sudah login",
    "Signed out": "Belum login",
    "Sign in": "Login",
    "Account Manager": "Manajemen akun",
    "Language": "Bahasa",
    "English": "English",
    "Bahasa Indonesia": "Bahasa Indonesia",
    "Chinese (Simplified)": "Bahasa Mandarin (Sederhana)",
    "Concise Output": "Output Ringkas",
    "Architecture & Risk Review": "Tinjauan Arsitektur dan Risiko",
    "Cross-check Facts": "Pemeriksaan Fakta Silang",
    "Direct answers only—conclusions and key points without filler.": "Arahkan setiap anggota untuk langsung menyampaikan kesimpulan dan poin penting tanpa basa-basi.",
    "Respond concisely; give direct conclusions, key rationale, and actionable steps without filler or pleasantries.": "Berikan kesimpulan, dasar utama, dan langkah yang dapat dilakukan secara langsung tanpa basa-basi.",
    "Review from four angles: stability, edge cases, security, and performance.": "Berikan masukan dari sisi stabilitas, kasus tepi, keamanan, dan kinerja.",
    "When analyzing technical designs, prioritize edge cases, concurrency races, permission security, and resource usage, and clearly state trade-offs and risks.": "Saat menganalisis solusi teknis, periksa kasus tepi, kondisi balapan, keamanan izin, dan penggunaan sumber daya.",
    "Point out flaws in prior statements or premises before adding new conclusions.": "Tunjukkan kekurangan pada pernyataan atau asumsi sebelumnya sebelum menambahkan kesimpulan.",
    "If shared context or prior member replies contain contradictions, flawed assumptions, or omissions, correct them first before adding your judgment.": "Jika konteks bersama atau pernyataan anggota sebelumnya mengandung kontradiksi, asumsi keliru, atau kekurangan, koreksi terlebih dahulu.",
    "Local Ollama": "Ollama Lokal",
    "Local CLI": "CLI Lokal",
    "Exhausted": "Habis",
    "Low": "Rendah",
    "Depleted": "Habis",
    "Daily Full": "Batas harian tercapai",
    "Monthly Full": "Batas bulanan tercapai",
    "Extra Used": "Gunakan kuota tambahan",
    "Reset": "Atur ulang",
    "Month": "Bulan",
    "Extra": "Tambahan",
    "Extra Quota": "Kuota tambahan",
    "Cookie expired": "Cookie kedaluwarsa",
    "Session only": "Hanya berlaku untuk sesi ini",
    "Verifying": "Memverifikasi",
    "Replacing": "Mengganti",
    "Complete": "Selesai",
    "Awaiting Authorization": "Menunggu otorisasi",
    "Preparing download...": "Menyiapkan unduhan...",
    "Updating...": "Memperbarui...",
    "Authorized, Continue Install": "Diizinkan, lanjutkan instalasi",
    "Download IPA": "Unduh IPA",
    "Download & Update Now": "Unduh dan perbarui sekarang",
    "Checking...": "Memeriksa...",
    "Check Again": "Periksa ulang",
    "Regenerate": "Buat ulang",
    "Starting...": "Mengaktifkan...",
    "Restart Sharing": "Aktifkan ulang",
    "Start Sharing": "Aktifkan berbagi",
    "Relay Channel": "Kanal relay",
    "LAN Address": "Alamat LAN",
    "End-to-End Encryption": "Enkripsi end-to-end",
    "Sync Passcode": "Kode sinkronisasi",
    "Deletion Policy": "Kebijakan penghapusan",
    "Validity": "Masa berlaku",
    "Auto-destroy after": "Hapus otomatis setelahnya",
    "Destroy & Stop Now": "Hapus dan hentikan sekarang",
    "Stop Sharing": "Hentikan berbagi",
    "Pulling...": "Mengambil data...",
    "Pull & Merge": "Ambil dan gabungkan",
    "Exporting...": "Mengekspor...",
    "Export Backup": "Ekspor cadangan",
    "Importing...": "Mengimpor...",
    "Decrypt & Import": "Dekripsi dan impor",
    "Default": "Bawaan",
    "Disable": "Nonaktifkan",
    "Shortcut Active": "Pintasan aktif",
    "Inactive": "Tidak aktif",
    "Disabled": "Dinonaktifkan",
    "5 minutes": "5 menit",
    "15 minutes": "15 menit",
    "30 minutes": "30 menit",
    "Manual only": "Hanya manual",
    "Active": "Aktif",
    "Registration Failed": "Registrasi gagal",
    "Not Enabled": "Belum diaktifkan",
    "Saving...": "Menyimpan...",
    "Account Settings": "Pengaturan akun",
    "Display Name": "Nama tampilan",
    "Import Cookies": "Impor Cookie",
    "Confirm Clear?": "Yakin ingin menghapus semua?",
    "Clear Login Cache": "Hapus cache login",
    "Creating...": "Membuat...",
    "Create & Open": "Buat dan buka",
    "Create Group Chat": "Buat obrolan grup",
    "Group Name": "Nama grup",
    "Edit Shared Skill": "Edit keahlian bersama",
    "Add Custom Skill": "Tambah keahlian khusus",
    "Update Skill": "Perbarui keahlian",
    "+ Add Skill": "+ Tambah keahlian",
    "Edit Member": "Edit anggota",
    "Add Direct Member": "Tambah anggota koneksi langsung",
    "Update Member": "Perbarui anggota",
    "+ Save Member": "+ Simpan anggota",
    "Encrypted Multi-Device Sync": "Sinkronisasi terenkripsi multi-perangkat",
    "Move Up": "Pindah ke atas",
    "Move Down": "Pindah ke bawah",
    "Force Reload Page": "Paksa muat ulang halaman",
    "Copy Cookie": "Salin Cookie",
    "Remove from Device": "Hapus dari perangkat ini",
    "All Members": "Semua anggota",
    "Draft": "Draf awal",
    "Final Synthesis": "Final gabungan",
    "Cross-Review": "Tinjauan silang",
    "Members": "Anggota",
    "Delete Group Chat": "Hapus obrolan grup",
    "Save to Shared Context": "Simpan ke konteks bersama",
    "Sync Latest Replies": "Sinkronkan balasan terbaru",
    "Keep Shared Context": "Pertahankan konteks bersama",
    "Clear All": "Hapus semua",
    "New Topic": "Topik baru",
    "Clear History": "Hapus riwayat",
    "Mode": "Mode",
    "Parallel": "Paralel",
    "Review Flow": "Alur tinjauan",
    "A2A Relay": "Relay A2A",
    "Relay Limit": "Batas relay",
    "Replying": "Sedang membalas",
    "Copy Sync String": "Salin string sinkronisasi",
    "Export Encrypted Backup (.maam)": "Ekspor cadangan terenkripsi (.maam)",
    "Show File Location": "Buka lokasi file",
    "Import & Decrypt Backup": "Impor dan dekripsi cadangan",
    "QR Scan / LAN": "Pindai QR / LAN",
    "Encrypted Backup File": "File cadangan terenkripsi",
    "Desktop Settings": "Pengaturan desktop",
    "Test Connection": "Uji koneksi",
    "Testing...": "Menguji...",
    "Cancel Edit": "Batalkan pengeditan",
    "No Members": "Belum ada anggota",
    "Reading rules…": "Membaca aturan…",
    "Save & Apply Live": "Simpan dan terapkan langsung",
    "Save Config": "Simpan konfigurasi",
    "Open Official Site": "Buka situs resmi",
    "Top Quota": "Sisa terbanyak",
    "Sort by Quota": "Urutkan kuota",
    "Clear & Re-login": "Bersihkan sesi dan login ulang",
    "Error": "Status bermasalah",
    "Show in Folder": "Tampilkan di folder",
    "No Group Chats": "Belum ada obrolan grup",
    "+ Create Group": "+ Buat obrolan grup",
    "Queued…": "Dalam antrean…",
    "Delivering…": "Mengirim…",
    "Replying…": "Membalas…",
    "Awaiting Approval": "Menunggu otorisasi",
    "Incomplete": "Belum selesai",
    "Retry": "Coba lagi",
    "Package Contents": "Isi paket",
    "Direct": "Langsung",
    "Edit": "Edit",
    "Reset Session": "Atur ulang sesi",
    "Restore Defaults": "Pulihkan default bawaan",
    "Shared Context": "Konteks bersama",
    "Roles & Sessions": "Tugas & sesi",
    "Site Rules": "Aturan situs",
    "Confirm Delete": "Konfirmasi penghapusan",
    "Confirm Remove": "Konfirmasi penghapusan",
    "+ Add": "+ Tambah",
    "Open": "Buka",
    "Multi-Account Group Chat": "Obrolan grup multi-akun",
    "Release Page": "Halaman rilis",
    "Dismiss Notice": "Tutup pemberitahuan",
    "Ownership": "Kepemilikan",
    "Manual Rename": "Ubah nama secara manual",
    "Email not detected": "Email tidak ditemukan",
    "Loading": "Sedang memuat",
    "Latest": "Terbaru",
    "Shared Skills": "Keahlian bersama",
    "Copying…": "Menyalin…",
    "Cookie Copied": "Cookie disalin",
    "[User]": "[Pengguna]",
    "Duohao": "Duohao",
    "Duohao · AI Account Switcher": "Duohao · Pengalih Akun AI",
    "No accounts yet": "Belum ada akun",
    "Refresh ready account quotas": "Perbarui kuota akun yang siap"
  }
};

function maamTranslateText(text: string): string {
  if (maamLanguage === "en") return text;
  const dict = MAAM_TRANSLATIONS[maamLanguage] || {};
  const exact = dict[text];
  if (exact !== undefined) return exact;
  const numericCount = /^([0-9]+)\s+(members?|groups?|hops?)$/i.exec(text);
  if (numericCount) {
    const unit = numericCount[2].toLowerCase();
    const noun = unit.startsWith("member")
      ? (maamLanguage === "zh" ? "人" : " anggota")
      : unit.startsWith("group")
        ? (maamLanguage === "zh" ? "群" : " grup")
        : (maamLanguage === "zh" ? "跳" : " lompatan");
    return numericCount[1] + noun;
  }
  return text;
}

let maamObserver: MutationObserver | null = null;
let maamObserverQueued = false;

function applyMaamLocalization(): void {
  document.documentElement.lang = maamLanguage === "zh" ? "zh-CN" : maamLanguage;
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) return;

  const selector = root.querySelector<HTMLSelectElement>("#maam-language-selector");
  if (selector) selector.value = maamLanguage;

  if (maamLanguage === "en") {
    if (maamObserver) {
      maamObserver.disconnect();
      maamObserver = null;
    }
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  for (const node of nodes) {
    const original = node.textContent || "";
    const trimmed = original.trim();
    if (!trimmed) continue;
    if (node.parentElement?.closest("script,style,textarea,pre,code,[contenteditable='true'],.group-bubble,.group-msg-text,.group-row-preview,.group-msg-preview,.account-alias")) continue;
    const translated = maamTranslateText(trimmed);
    if (translated !== trimmed) {
      const leading = original.match(/^\s*/)?.[0] || "";
      const trailing = original.match(/\s*$/)?.[0] || "";
      node.textContent = leading + translated + trailing;
    }
  }

  root.querySelectorAll<HTMLElement>("[placeholder], [title], [aria-label], [data-tooltip], [alt]").forEach(el => {
    for (const attr of ["placeholder", "title", "aria-label", "data-tooltip", "alt"]) {
      const value = el.getAttribute(attr);
      if (value) {
        const translated = maamTranslateText(value);
        if (translated !== value) el.setAttribute(attr, translated);
      }
    }
  });

  if (!maamObserver && typeof MutationObserver !== "undefined") {
    maamObserver = new MutationObserver(() => {
      if (maamObserverQueued) return;
      maamObserverQueued = true;
      Promise.resolve().then(() => {
        maamObserverQueued = false;
        applyMaamLocalization();
      });
    });
    maamObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label", "data-tooltip", "alt"]
    });
  }
}
function maamLanguageSelectorHtml(): string {
  const languageLabel = maamLanguage === "id" ? "Bahasa" : maamLanguage === "zh" ? "语言" : "Language";
  const langTitle = `${languageLabel}: English / Bahasa Indonesia / Chinese`;
  return '<div class="rail-lang-wrap"><select id="maam-language-selector" class="rail-lang-select" aria-label="' + languageLabel + '" title="' + langTitle + '"><option value="en">EN</option><option value="id">ID</option><option value="zh">ZH</option></select></div>';
}
function bindMaamLanguageSelector(): void {
  const select = document.querySelector<HTMLSelectElement>("#maam-language-selector");
  if (!select) return;
  select.value = maamLanguage;
  select.onchange = () => {
    maamLanguage = select.value as MaamLanguage;
    try { localStorage.setItem(MAAM_LANG_KEY, maamLanguage); } catch {}
    render();
  };
}
// End MAAM_LOCALIZATION_OVERLAY

function render(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root || !snapshot) return;
  // MAAM localization is applied after each render.
  

  const focusedInput = document.activeElement;
  const preservedInputIds = new Set([
    "modal-alias-input",
    "modal-proxy-input",
    "modal-timezone-input",
    "modal-shortcut-input",
    "modal-group-name-input",
    "modal-group-context-input",
    "modal-skill-name-input",
    "modal-skill-desc-input",
    "modal-skill-content-input",
    "modal-adapters-json-input",
    "ext-agent-name-input",
    "ext-agent-url-input",
    "ext-agent-key-input",
    "ext-agent-model-input",
    "ext-agent-cmd-input",
    "ext-agent-args-input",
    "ext-agent-workdir-input",
    "group-chat-input",
    "ac-history-search-input",
  ]);
  const accountInputSelection =
    (focusedInput instanceof HTMLInputElement || focusedInput instanceof HTMLTextAreaElement) &&
    preservedInputIds.has(focusedInput.id)
      ? {
          id: focusedInput.id,
          start: focusedInput.selectionStart,
          end: focusedInput.selectionEnd,
          direction: focusedInput.selectionDirection,
        }
      : null;

  const provider = currentProvider(snapshot);
  
  const isMobile = isMobilePlatform(snapshot.platform);
  const isGroupsView = !isMobile && viewMode === "groups";
  const isRouterView = !isMobile && viewMode === "router";
  const isAgentCenterView = !isMobile && viewMode === "agent_center";
  const isProviderView = !isMobile && viewMode === "provider";
  const anyGroupNeedsAuth = snapshot.groupChats.some(groupHasNeedsAuth);
  const activeTaskCount = (snapshot.tasks ?? []).filter(
    (t) => t.status === "running" || t.status === "waiting_approval"
  ).length;
  const activeLeaseCount = (snapshot.accountLeases ?? []).filter(
    (l) => l.expiresAtMs > Date.now()
  ).length;

  const renderSharedChrome = (st: ManagerSnapshot, prov: ProviderInfo): string => {
    const noticeHtml = st.notice
      ? `
        <div class="notice-bar">
          <span>${escapeHtml(st.notice)}</span>
          <button id="dismiss-notice-btn" class="notice-close" type="button" title="Dismiss notice">✕</button>
        </div>
      `
      : "";
    return `${noticeHtml}${renderDownloadToast()}${renderModal(st, prov)}`;
  };

  const featureDeps: SmartRouterViewDeps & AgentCenterViewDeps = {
    callCmd: async <T = ManagerSnapshot>(cmd: string, args?: Record<string, unknown>) =>
      invoke<T>(cmd, args),
    applySnapshot: (nextSnap: ManagerSnapshot) => {
      snapshot = nextSnap;
      rerenderPreservingScroll();
    },
    rerender: () => {
      rerenderPreservingScroll();
    },
    escapeHtml,
    renderSharedChrome,
  };

  if (isMobile) {
    root.innerHTML = `
      <div class="mobile-shell">
        <div class="mobile-tabs">
          ${snapshot.providers
            .map(
              (p) => `
              <button class="mobile-tab ${p.id === provider.id ? "active" : ""}" data-provider="${escapeHtml(p.id)}" type="button">
                ${renderProviderLogo(p, "mobile-tab-logo")}
                <span>${escapeHtml(p.shortName)}</span>
              </button>
            `
            )
            .join("")}
        </div>
        <div class="middle-column" style="width:100%;min-width:0;flex:1;border-right:none;">
          ${renderMiddleContent(snapshot, provider)}
        </div>
      </div>
    `;
    applyMaamLocalization();
    bindMaamLanguageSelector();
  } else {
    const middleHtml = isGroupsView
      ? renderGroupMiddleContent(snapshot, provider)
      : isRouterView
        ? renderSmartRouterMiddle(snapshot, provider, featureDeps)
        : isAgentCenterView
          ? renderAgentCenterMiddle(snapshot, provider, featureDeps)
          : renderMiddleContent(snapshot, provider);

    const stageHtml = isGroupsView
      ? renderGroupRightStage(snapshot)
      : isRouterView
        ? renderSmartRouterStage(snapshot, featureDeps)
        : isAgentCenterView
          ? renderAgentCenterStage(snapshot, featureDeps)
          : renderRightStage(snapshot, provider);

    root.innerHTML = `
      <div class="desktop-shell">
        <aside class="service-rail">
          <div class="rail-brand" title="Duohao · AI Account Switcher">
            <img src="/logos/app-logo.svg" alt="Duohao" class="rail-brand-img" draggable="false" />
          </div>
          <div class="rail-divider"></div>
          <div class="rail-providers">
            <button id="group-chat-rail-btn" class="rail-btn ${isGroupsView ? "active" : ""}" title="Multi-Account Group Chat (Desktop)" type="button">
              <div class="rail-logo-box rail-group-icon">${ICON_GROUP}${anyGroupNeedsAuth ? `<span class="warn-dot" aria-hidden="true"></span>` : ""}</div>
              <span class="rail-label">Groups</span>
            </button>
            <button id="agent-center-rail-btn" class="rail-btn ${isAgentCenterView ? "active" : ""}" title="Agent Center · Orchestrator & Pipelines" type="button">
              <div class="rail-logo-box rail-group-icon">${ICON_AGENT_CENTER}${activeTaskCount > 0 ? `<span class="warn-dot" aria-hidden="true"></span>` : ""}</div>
              <span class="rail-label">Agents</span>
            </button>
            <button id="router-rail-btn" class="rail-btn ${isRouterView ? "active" : ""}" title="Smart Router · Quota & Lease Pool" type="button">
              <div class="rail-logo-box rail-group-icon">${ICON_ROUTER}${activeLeaseCount > 0 ? `<span class="warn-dot" aria-hidden="true"></span>` : ""}</div>
              <span class="rail-label">Router</span>
            </button>
            <div class="rail-divider"></div>
            ${snapshot.providers
              .map(
                (p) => `
                <button class="rail-btn ${isProviderView && p.id === provider.id ? "active" : ""} ${!p.enabled ? "disabled" : ""}" data-provider="${escapeHtml(p.id)}" title="${escapeHtml(p.name)}" type="button">
                  <div class="rail-logo-box">${renderProviderLogo(p, "rail-logo-img")}</div>
                  <span class="rail-label">${escapeHtml(p.shortName)}</span>
                  ${!p.enabled ? `<span class="rail-pending-tag">Coming Soon</span>` : ""}
                </button>
              `
              )
              .join("")}
          </div>
          <div class="rail-footer">
          ${maamLanguageSelectorHtml()}
            <button
              id="sync-btn"
              class="rail-util-btn"
              title="Cross-device encrypted sync"
              type="button"
            >
              ${ICON_SYNC}
              <span class="rail-util-label">Sync</span>
            </button>
            <button
              id="settings-btn"
              class="rail-util-btn ${snapshot.globalShortcutError ? "has-warn" : ""}"
              title="${snapshot.globalShortcutError ? escapeHtml(snapshot.globalShortcutError) : "Tray & global shortcut settings"}"
              type="button"
            >
              ${ICON_SETTINGS}
              <span class="rail-util-label">Settings</span>
              ${snapshot.globalShortcutError ? `<span class="warn-dot" aria-hidden="true"></span>` : ""}
            </button>
            <button
              id="theme-toggle-btn"
              class="rail-util-btn"
              title="Theme: ${themeLabel(themeMode)} (click to switch)"
              type="button"
            >
              ${themeIcon(themeMode)}
              <span class="rail-util-label">${themeLabel(themeMode)}</span>
            </button>
            <button
              id="check-update-btn"
              class="rail-util-btn ${updateState.result?.hasUpdate ? "has-update" : ""}"
              title="${updateState.result?.hasUpdate ? `New version v${escapeHtml(updateState.result.latestVersion)} (click to update)` : "Check for updates"}"
              type="button"
            >
              ${ICON_UPDATE}
              <span class="rail-util-label">${updateState.result?.hasUpdate ? "New Ver" : "Update"}</span>
              ${updateState.result?.hasUpdate ? `<span class="update-dot" aria-hidden="true"></span>` : ""}
            </button>
          </div>
        </aside>
        <section class="middle-column">${middleHtml}</section>
        ${stageHtml}
      </div>
    `;
    applyMaamLocalization();
    bindMaamLanguageSelector();
  }

  bindEvents(snapshot, provider);
  if (!isMobile && viewMode === "router") {
    bindSmartRouterEvents(snapshot, featureDeps);
  } else if (!isMobile && viewMode === "agent_center") {
    bindAgentCenterEvents(snapshot, featureDeps);
  }
  if (accountInputSelection) {
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `#${accountInputSelection.id}`
    );
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(
      accountInputSelection.start,
      accountInputSelection.end,
      accountInputSelection.direction ?? undefined
    );
  }
  shouldAnimateModal = false;
}

function bindEvents(state: ManagerSnapshot, provider: ProviderInfo): void {
  document.querySelector("#group-chat-rail-btn")?.addEventListener("click", async () => {
    if (viewMode === "groups") return;
    if (modal.kind !== "none") {
      await setModal({ kind: "none" });
    }
    viewMode = "groups";
    const targetId = state.activeGroupId ?? state.groupChats[0]?.id ?? null;
    await callCommand("select_group_chat", { groupId: targetId });
  });

  document.querySelector("#agent-center-rail-btn")?.addEventListener("click", async () => {
    if (viewMode === "agent_center") return;
    if (modal.kind !== "none") {
      await setModal({ kind: "none" });
    }
    viewMode = "agent_center";
    if (state.activeGroupId) {
      await callCommand("select_group_chat", { groupId: null });
    } else {
      rerenderPreservingScroll();
    }
  });

  document.querySelector("#router-rail-btn")?.addEventListener("click", async () => {
    if (viewMode === "router") return;
    if (modal.kind !== "none") {
      await setModal({ kind: "none" });
    }
    viewMode = "router";
    resetSmartRouterDraftFromSnapshot(state);
    if (state.activeGroupId) {
      await callCommand("select_group_chat", { groupId: null });
    } else {
      rerenderPreservingScroll();
    }
  });

  document.querySelectorAll<HTMLElement>("[data-provider]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nextId = btn.dataset.provider as ProviderId;
      if (!nextId || (viewMode === "provider" && nextId === state.selectedProviderId)) return;
      if (modal.kind !== "none") {
        await setModal({ kind: "none" });
      }
      viewMode = "provider";
      await callCommand("select_provider", { providerId: nextId });
    });
  });

  const handleOpenCreateGroup = async () => {
    await openCreateGroupModal(state);
  };
  document.querySelector("#create-group-btn")?.addEventListener("click", handleOpenCreateGroup);
  document.querySelector("#stage-create-group-btn")?.addEventListener("click", handleOpenCreateGroup);

  const handleOpenExternalAgents = async () => {
    await openExternalAgentsModal();
  };
  document
    .querySelector("#manage-external-agents-btn")
    ?.addEventListener("click", handleOpenExternalAgents);
  document
    .querySelector("#open-external-agents-from-group-btn")
    ?.addEventListener("click", handleOpenExternalAgents);

  document.querySelectorAll<HTMLElement>("[data-open-ext-agent-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (modal.kind !== "none") return;
      const eid = btn.dataset.openExtAgentId;
      const ext = (state.externalAgents ?? []).find((a) => a.id === eid);
      if (ext) {
        await openExternalAgentsModal(ext);
      }
    });
  });

  document.querySelectorAll<HTMLElement>("[data-edit-group-id]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const gid = btn.dataset.editGroupId;
      const g = state.groupChats.find((x) => x.id === gid);
      if (g) {
        await openEditGroupModal(g);
      }
    });
  });

  document.querySelectorAll<HTMLElement>("[data-delete-group-id]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const gid = btn.dataset.deleteGroupId;
      const g = state.groupChats.find((x) => x.id === gid);
      if (g) {
        await setModal({ kind: "delete-group", group: g });
      }
    });
  });

  document.querySelectorAll<HTMLElement>("[data-select-group-id]").forEach((row) => {
    row.addEventListener("click", async () => {
      if (modal.kind !== "none") return;
      const gid = row.dataset.selectGroupId;
      if (!gid || gid === state.activeGroupId) return;
      forceGroupScrollBottom = true;
      await callCommand("select_group_chat", { groupId: gid });
    });
  });

  document.querySelector("#group-knowledge-btn")?.addEventListener("click", async () => {
    const activeGroup = state.activeGroupId
      ? state.groupChats.find((g) => g.id === state.activeGroupId)
      : undefined;
    if (activeGroup) {
      await openGroupKnowledgeModal(activeGroup);
    }
  });

  document.querySelectorAll<HTMLButtonElement>("[data-pin-msg-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (modal.kind !== "none" || !state.activeGroupId) return;
      const msgId = btn.dataset.pinMsgId;
      const activeGroup = state.groupChats.find((g) => g.id === state.activeGroupId);
      const msg = activeGroup?.messages.find((m) => m.id === msgId);
      if (!msg || !msg.content.trim()) return;
      const prefix =
        msg.role === "user"
          ? "[User]"
          : `[${resolveGroupMessageSenderName(state, msg)}]`;
      await callCommand("append_group_shared_context", {
        groupId: state.activeGroupId,
        snippet: `${prefix}: ${msg.content.trim()}`,
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-retry-msg-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (modal.kind !== "none" || !state.activeGroupId) return;
      const msgId = btn.dataset.retryMsgId;
      if (!msgId) return;
      await callCommand("retry_group_message", {
        groupId: state.activeGroupId,
        msgId,
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-sync-msg-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (modal.kind !== "none" || !state.activeGroupId || busy) return;
      const msgId = btn.dataset.syncMsgId;
      if (!msgId || syncingMsgIds.has(msgId)) return;
      syncingMsgIds.add(msgId);
      rerenderPreservingScroll();
      try {
        await callCommand("sync_group_message_reply", {
          groupId: state.activeGroupId,
          msgId,
        });
      } finally {
        syncingMsgIds.delete(msgId);
        rerenderPreservingScroll();
      }
    });
  });

  document.querySelector("#group-edit-members-btn")?.addEventListener("click", async () => {
    const activeGroup = state.activeGroupId
      ? state.groupChats.find((g) => g.id === state.activeGroupId)
      : undefined;
    if (activeGroup) {
      await openEditGroupModal(activeGroup);
    }
  });

  document.querySelector("#group-clear-msgs-btn")?.addEventListener("click", async () => {
    if (!state.activeGroupId) return;
    await callCommand("clear_group_messages", { groupId: state.activeGroupId });
  });

  document.querySelector("#group-new-topic-btn")?.addEventListener("click", () => {
    if (modal.kind !== "none" || !state.activeGroupId) return;
    newTopicConfirmGroupId = state.activeGroupId;
    rerenderPreservingScroll();
  });

  document.querySelector("#group-new-topic-cancel-btn")?.addEventListener("click", () => {
    newTopicConfirmGroupId = null;
    rerenderPreservingScroll();
  });

  const startNewTopic = async (keepSharedContext: boolean) => {
    const gid = state.activeGroupId;
    newTopicConfirmGroupId = null;
    if (!gid) return;
    groupDrafts[gid] = "";
    groupTargets[gid] = [];
    groupAutoChannels[gid] = [];
    await callCommand("start_group_new_topic", { groupId: gid, keepSharedContext });
  };

  document.querySelector("#group-new-topic-keep-btn")?.addEventListener("click", () => {
    void startNewTopic(true);
  });

  document.querySelector("#group-new-topic-clean-btn")?.addEventListener("click", () => {
    void startNewTopic(false);
  });

  document.querySelector("#group-pin-round-btn")?.addEventListener("click", async () => {
    if (modal.kind !== "none" || !state.activeGroupId) return;
    const activeGroup = state.groupChats.find((g) => g.id === state.activeGroupId);
    if (!activeGroup) return;
    const round = getLatestRoundCompletedReplies(state, activeGroup);
    if (!round) return;
    const head = round.userText
      ? `Conclusions (Topic: ${round.userText.replace(/\s+/g, " ").slice(0, 80)})`
      : "Conclusions";
    const lines = round.replies.map(
      (r, i) => `- Viewpoint ${i + 1}: ${r.text.replace(/\s+/g, " ").slice(0, 280)}`
    );
    const snippet = `${head}\n${lines.join("\n")}`.slice(0, 1800);
    await callCommand("append_group_shared_context", {
      groupId: state.activeGroupId,
      snippet,
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-workflow-mode]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (modal.kind !== "none" || !state.activeGroupId) return;
      const mode = btn.dataset.workflowMode as GroupWorkflowMode | undefined;
      const activeGroup = state.groupChats.find((g) => g.id === state.activeGroupId);
      if (!mode || !activeGroup || (activeGroup.workflowMode ?? "parallel") === mode) return;
      await callCommand("update_group_workflow", {
        groupId: activeGroup.id,
        workflowMode: mode,
        maxRelayHops: activeGroup.maxRelayHops ?? 2,
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-relay-hops]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (modal.kind !== "none" || !state.activeGroupId) return;
      const hops = Number(btn.dataset.relayHops ?? "2");
      const activeGroup = state.groupChats.find((g) => g.id === state.activeGroupId);
      if (!activeGroup || !Number.isFinite(hops) || (activeGroup.maxRelayHops ?? 2) === hops) {
        return;
      }
      await callCommand("update_group_workflow", {
        groupId: activeGroup.id,
        workflowMode: activeGroup.workflowMode ?? "a2a_relay",
        maxRelayHops: hops,
      });
    });
  });

  document.querySelectorAll<HTMLElement>("[data-jump-provider]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (modal.kind !== "none") return;
      const pid = btn.dataset.jumpProvider;
      const uuid = btn.dataset.jumpUuid;
      if (!pid || !uuid) return;
      viewMode = "provider";
      const alreadyWarm = state.warmAccounts.some(
        (k) => k.providerId === pid && k.uuid === uuid
      );
      await callCommand(
        "switch_account",
        { providerId: pid, uuid },
        alreadyWarm ? null : { providerId: pid, uuid }
      );
    });
  });

  document.querySelector('[data-group-target="all"]')?.addEventListener("click", () => {
    if (!state.activeGroupId) return;
    groupTargets[state.activeGroupId] = [];
    groupAutoChannels[state.activeGroupId] = [];
    rerenderPreservingScroll();
  });

  document.querySelectorAll<HTMLElement>("[data-group-target-auto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const gid = state.activeGroupId;
      const catId = btn.dataset.groupTargetAuto;
      if (!gid || !catId) return;
      const currentAuto = [...(groupAutoChannels[gid] ?? [])];
      const idx = currentAuto.indexOf(catId);
      if (idx >= 0) {
        currentAuto.splice(idx, 1);
      } else {
        currentAuto.push(catId);
        // Same-channel mutual exclusion: enabling channel auto clears any @account in that channel
        groupTargets[gid] = (groupTargets[gid] ?? []).filter(
          (t) => resolveMemberCategory(state, t).id !== catId
        );
      }
      groupAutoChannels[gid] = currentAuto;
      rerenderPreservingScroll();
    });
  });

  document.querySelectorAll<HTMLElement>("[data-group-target-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const gid = state.activeGroupId;
      const catId = btn.dataset.groupTargetCat;
      if (!gid || !catId) return;
      const activeGroup = state.groupChats.find((g) => g.id === gid);
      if (!activeGroup) return;
      const catMembers = activeGroup.members.filter((m) => {
        const meta = resolveMemberMeta(state, m);
        return !meta.loggedOut && resolveMemberCategory(state, m).id === catId;
      });
      if (catMembers.length === 0) return;
      const current = [...(groupTargets[gid] ?? [])];
      const allSelected = catMembers.every((cm) =>
        current.some((cur) => sameAccountKey(cur, cm))
      );
      if (allSelected) {
        groupTargets[gid] = current.filter(
          (cur) => !catMembers.some((cm) => sameAccountKey(cur, cm))
        );
      } else {
        for (const cm of catMembers) {
          if (!current.some((cur) => sameAccountKey(cur, cm))) {
            current.push({ providerId: cm.providerId, uuid: cm.uuid });
          }
        }
        groupTargets[gid] = current;
        groupAutoChannels[gid] = (groupAutoChannels[gid] ?? []).filter((c) => c !== catId);
      }
      rerenderPreservingScroll();
    });
  });

  document.querySelectorAll<HTMLElement>("[data-group-target-provider]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const gid = state.activeGroupId;
      const pid = btn.dataset.groupTargetProvider;
      const uuid = btn.dataset.groupTargetUuid;
      if (!gid || !pid || !uuid) return;
      const current = [...(groupTargets[gid] ?? [])];
      const idx = current.findIndex((k) => k.providerId === pid && k.uuid === uuid);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push({ providerId: pid, uuid });
        const catId = resolveMemberCategory(state, { providerId: pid, uuid }).id;
        groupAutoChannels[gid] = (groupAutoChannels[gid] ?? []).filter((c) => c !== catId);
      }
      groupTargets[gid] = current;
      rerenderPreservingScroll();
    });
  });

  const submitGroupMessage = async () => {
    const gid = state.activeGroupId;
    if (!gid || groupSending) return;
    const raw = (groupDrafts[gid] ?? "").trim();
    if (!raw) return;
    const group = state.groupChats.find((g) => g.id === gid);
    const chosen = (groupTargets[gid] ?? []).filter((t) =>
      group?.members.some((m) => sameAccountKey(m, t))
    );
    const membersForMention = (group?.members ?? []).map((m) => ({
      key: m,
      alias: resolveMemberMeta(state, m).alias,
    }));
    const inline = extractComposerAtMentions(raw, membersForMention);
    let chosenAutoChannels: string[] = [];
    if (!inline.isAll) {
      const explicitForConflict = inline.hasMention ? inline.targets : chosen;
      const conflictCats = new Set(
        explicitForConflict.map((t) => resolveMemberCategory(state, t).id)
      );
      chosenAutoChannels = (groupAutoChannels[gid] ?? []).filter(
        (catId) =>
          !conflictCats.has(catId) &&
          (group?.members ?? []).some((m) => {
            const meta = resolveMemberMeta(state, m);
            return !meta.loggedOut && resolveMemberCategory(state, m).id === catId;
          })
      );
      groupAutoChannels[gid] = chosenAutoChannels;
    }
    groupSending = true;
    forceGroupScrollBottom = true;
    groupDrafts[gid] = "";
    render();
    restoreScrollPosition();
    let ok = false;
    try {
      ok = await callCommand("send_group_message", {
        groupId: gid,
        content: raw,
        targetMembers: chosen.length > 0 ? chosen : null,
        autoChannels: chosenAutoChannels.length > 0 ? chosenAutoChannels : null,
      });
    } finally {
      groupSending = false;
      if (!ok && !groupDrafts[gid]) {
        groupDrafts[gid] = raw;
      }
      render();
      restoreScrollPosition();
    }
  };

  const groupInputEl = document.querySelector<HTMLTextAreaElement>("#group-chat-input");
  if (groupInputEl && state.activeGroupId) {
    const activeGid = state.activeGroupId;
    const activeGroup = state.groupChats.find((g) => g.id === activeGid);
    const mentionMenuEl = document.querySelector<HTMLElement>("#group-mention-menu");
    const targetHintEl = document.querySelector<HTMLElement>("#group-target-hint");

    type MentionCandidate = { label: string; sub: string; insert: string; groupLabel?: string };
    const composerMembers = (activeGroup?.members ?? []).map((m) => ({
      key: m,
      alias: resolveMemberMeta(state, m).alias,
      categoryId: resolveMemberCategory(state, m).id,
    }));
    const activeWorkflowMode: GroupWorkflowMode = activeGroup?.workflowMode ?? "parallel";
    const activeRelayHops = activeGroup?.maxRelayHops ?? 2;
    const composerCategories = activeGroup
      ? groupByMemberCategory(
          state,
          activeGroup.members
            .filter((m) => !resolveMemberMeta(state, m).loggedOut)
            .map((m) => ({ key: m }))
        )
      : [];
    const mentionCandidates: MentionCandidate[] = activeGroup
      ? [
          {
            label: "all",
            sub: "Forward to all active members",
            insert: "all",
          },
          ...groupByMemberCategory(
            state,
            activeGroup.members.map((m) => ({ key: m }))
          ).flatMap((cat) =>
            cat.items.map(({ key: m }) => {
              const meta = resolveMemberMeta(state, m);
              const roleText = (activeGroup.memberRoles ?? []).find((r) =>
                sameAccountKey(r.member, m)
              )?.role;
              return {
                label: meta.alias,
                sub: meta.loggedOut
                  ? `${cat.label} · Signed out`
                  : meta.pageError
                    ? `${cat.label} · Page error`
                    : roleText
                      ? `${cat.label} · ${roleText}`
                      : cat.label,
                insert: meta.alias,
                groupLabel: cat.label,
              };
            })
          ),
        ]
      : [];

    let filteredMentions: MentionCandidate[] = [];
    let activeMentionStart = -1;
    let activeMentionIdx = 0;

    const findActiveAtQuery = (
      val: string,
      cursor: number
    ): { start: number; query: string } | null => {
      const before = val.slice(0, cursor);
      for (let i = before.length - 1; i >= 0; i -= 1) {
        const ch = before[i];
        if (/\s/.test(ch)) return null;
        if (ch === "@") {
          if (i > 0 && isAsciiWordChar(before[i - 1])) return null;
          return { start: i, query: before.slice(i + 1) };
        }
      }
      return null;
    };

    const syncInlineMentionAutoExclusion = () => {
      if (!activeGroup) return;
      const inline = extractComposerAtMentions(groupInputEl.value, composerMembers);
      if (!inline.hasMention) return;
      const prevAuto = groupAutoChannels[activeGid] ?? [];
      if (prevAuto.length === 0) return;

      let nextAuto = prevAuto;
      if (inline.isAll) {
        nextAuto = [];
      } else {
        const conflictCats = new Set(
          inline.targets.map((t) => resolveMemberCategory(state, t).id)
        );
        nextAuto = prevAuto.filter((catId) => !conflictCats.has(catId));
      }

      if (nextAuto.length !== prevAuto.length) {
        groupAutoChannels[activeGid] = nextAuto;
        const removed = prevAuto.filter((c) => !nextAuto.includes(c));
        for (const catId of removed) {
          document
            .querySelector(`[data-group-target-auto="${CSS.escape(catId)}"]`)
            ?.classList.remove("active");
          const catInfo = composerCategories.find((c) => c.id === catId);
          const allSelected = Boolean(
            catInfo &&
              catInfo.items.length > 0 &&
              catInfo.items.every((m) =>
                (groupTargets[activeGid] ?? []).some((t) => sameAccountKey(t, m.key))
              )
          );
          if (!allSelected) {
            document
              .querySelector(`[data-group-target-cat="${CSS.escape(catId)}"]`)
              ?.classList.remove("active");
          }
        }
        const validSelected = (groupTargets[activeGid] ?? []).filter((t) =>
          activeGroup.members.some((m) => sameAccountKey(m, t))
        );
        if (validSelected.length === 0 && nextAuto.length === 0) {
          document.querySelector('[data-group-target="all"]')?.classList.add("active");
        }
      }
    };

    const updateComposerHint = () => {
      if (!targetHintEl || !activeGroup) return;
      const validSelected = (groupTargets[activeGid] ?? []).filter((t) =>
        activeGroup.members.some((m) => sameAccountKey(m, t))
      );
      const validAutoLabels = (groupAutoChannels[activeGid] ?? [])
        .map((id) => {
          const cat = composerCategories.find((c) => c.id === id);
          return cat ? { id: cat.id, label: cat.label } : null;
        })
        .filter((x): x is { id: string; label: string } => Boolean(x));
      targetHintEl.textContent = formatComposerHintText(
        groupInputEl.value,
        validSelected,
        composerMembers,
        activeWorkflowMode,
        activeRelayHops,
        validAutoLabels
      );
    };

    const hideMentionMenu = () => {
      filteredMentions = [];
      activeMentionStart = -1;
      activeMentionIdx = 0;
      if (mentionMenuEl) {
        mentionMenuEl.hidden = true;
        mentionMenuEl.innerHTML = "";
      }
    };

    const applyMentionCandidate = (idx: number) => {
      const picked = filteredMentions[idx];
      if (!picked || activeMentionStart < 0) return;
      const cursor = groupInputEl.selectionStart ?? groupInputEl.value.length;
      const val = groupInputEl.value;
      const inserted = `@${picked.insert} `;
      const nextVal = val.slice(0, activeMentionStart) + inserted + val.slice(cursor);
      groupInputEl.value = nextVal;
      groupDrafts[activeGid] = nextVal;
      const nextCursor = activeMentionStart + inserted.length;
      groupInputEl.setSelectionRange(nextCursor, nextCursor);
      hideMentionMenu();
      syncInlineMentionAutoExclusion();
      updateComposerHint();
    };

    const renderMentionMenu = () => {
      if (!mentionMenuEl || filteredMentions.length === 0) {
        hideMentionMenu();
        return;
      }
      if (activeMentionIdx >= filteredMentions.length) activeMentionIdx = 0;
      if (activeMentionIdx < 0) activeMentionIdx = filteredMentions.length - 1;
      let prevGroup = "";
      mentionMenuEl.innerHTML = filteredMentions
        .map((c, i) => {
          let headerHtml = "";
          if (c.groupLabel && c.groupLabel !== prevGroup) {
            prevGroup = c.groupLabel;
            headerHtml = `<div class="group-mention-group-title">${escapeHtml(c.groupLabel)}</div>`;
          }
          return `
            ${headerHtml}
            <button
              class="group-mention-item ${i === activeMentionIdx ? "active" : ""}"
              data-mention-idx="${i}"
              type="button"
            >
              <span class="group-mention-item-label">@${escapeHtml(c.label)}</span>
              <span class="group-mention-item-sub">${escapeHtml(c.sub)}</span>
            </button>
          `;
        })
        .join("");
      mentionMenuEl.hidden = false;
      mentionMenuEl.querySelectorAll<HTMLButtonElement>("[data-mention-idx]").forEach((btn) => {
        btn.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          const idx = Number(btn.dataset.mentionIdx ?? "-1");
          if (idx >= 0) applyMentionCandidate(idx);
        });
      });
      mentionMenuEl
        .querySelector<HTMLElement>(".group-mention-item.active")
        ?.scrollIntoView({ block: "nearest" });
    };

    const syncMentionMenu = () => {
      if (!mentionMenuEl || mentionCandidates.length === 0) {
        hideMentionMenu();
        return;
      }
      const cursor = groupInputEl.selectionStart ?? groupInputEl.value.length;
      const activeAt = findActiveAtQuery(groupInputEl.value, cursor);
      if (!activeAt) {
        hideMentionMenu();
        return;
      }
      const q = activeAt.query.trim().toLowerCase();
      const matched = mentionCandidates.filter(
        (c) =>
          !q ||
          c.label.toLowerCase().includes(q) ||
          c.sub.toLowerCase().includes(q)
      );
      if (matched.length === 0) {
        hideMentionMenu();
        return;
      }
      activeMentionStart = activeAt.start;
      filteredMentions = matched;
      activeMentionIdx = 0;
      renderMentionMenu();
    };

    groupInputEl.addEventListener("input", () => {
      groupDrafts[activeGid] = groupInputEl.value;
      syncInlineMentionAutoExclusion();
      updateComposerHint();
      syncMentionMenu();
    });
    groupInputEl.addEventListener("click", () => {
      syncMentionMenu();
    });
    groupInputEl.addEventListener("blur", () => {
      window.setTimeout(hideMentionMenu, 120);
    });
    groupInputEl.addEventListener("keydown", (ev) => {
      if (mentionMenuEl && !mentionMenuEl.hidden && filteredMentions.length > 0) {
        if (ev.key === "ArrowDown") {
          ev.preventDefault();
          activeMentionIdx = (activeMentionIdx + 1) % filteredMentions.length;
          renderMentionMenu();
          return;
        }
        if (ev.key === "ArrowUp") {
          ev.preventDefault();
          activeMentionIdx =
            (activeMentionIdx - 1 + filteredMentions.length) % filteredMentions.length;
          renderMentionMenu();
          return;
        }
        if ((ev.key === "Enter" && !ev.isComposing) || ev.key === "Tab") {
          ev.preventDefault();
          applyMentionCandidate(activeMentionIdx);
          return;
        }
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          hideMentionMenu();
          return;
        }
      }
      if (ev.key === "Enter" && !ev.isComposing && (!ev.shiftKey || ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        void submitGroupMessage();
      }
    });
  }

  document.querySelector("#group-send-btn")?.addEventListener("click", () => {
    void submitGroupMessage();
  });

  document.querySelector("#theme-toggle-btn")?.addEventListener("click", () => {
    cycleThemeMode();
  });

  document.querySelector("#settings-btn")?.addEventListener("click", async () => {
    if (modal.kind !== "none") return;
    await setModal({
      kind: "settings",
      minimizeToTray: state.settings.minimizeToTray,
      globalShortcut: state.settings.globalShortcut,
      autoApprove: Boolean(state.settings.autoApprove),
      isolateSameProxyKeepAlive: state.settings.isolateSameProxyKeepAlive ?? true,
      silentSyncIntervalMins: state.settings.silentSyncIntervalMins ?? 15,
    });
  });

  document.querySelector("#sync-btn")?.addEventListener("click", async () => {
    if (modal.kind !== "none") return;
    let savedRelay = "";
    try {
      savedRelay = localStorage.getItem("maam_sync_relay_url") || "";
    } catch {
    }
    await setModal({
      kind: "sync",
      tab: "lan",
      relayEnabled: false,
      relayUrlDraft: savedRelay || snapshot?.officialRelayUrl || "",
      lanSharePassDraft: "",
      lanShareInfo: null,
      lanPullAddrDraft: "",
      lanPullPassDraft: "",
      fileExportPassDraft: "",
      fileExportResult: null,
      fileImportJsonDraft: "",
      fileImportPassDraft: "",
      importSummary: null,
    });
  });

  document.querySelector<HTMLInputElement>("#sync-relay-toggle")?.addEventListener("change", (ev) => {
    if (modal.kind !== "sync") return;
    modal.relayEnabled = Boolean((ev.currentTarget as HTMLInputElement).checked);
    modal.error = undefined;
    modal.copyHint = undefined;
    render();
  });

  document.querySelector<HTMLInputElement>("#sync-relay-url")?.addEventListener("input", (ev) => {
    if (modal.kind !== "sync") return;
    const val = (ev.currentTarget as HTMLInputElement).value;
    modal.relayUrlDraft = val;
    try {
      const trimmed = val.trim();
      if (trimmed) {
        localStorage.setItem("maam_sync_relay_url", trimmed);
      } else {
        localStorage.removeItem("maam_sync_relay_url");
      }
    } catch {
    }
    modal.error = undefined;
  });

  document.querySelector("#sync-tab-lan")?.addEventListener("click", () => {
    if (modal.kind !== "sync") return;
    modal.tab = "lan";
    modal.error = undefined;
    modal.copyHint = undefined;
    render();
  });

  document.querySelector("#sync-tab-file")?.addEventListener("click", () => {
    if (modal.kind !== "sync") return;
    modal.tab = "file";
    modal.error = undefined;
    modal.copyHint = undefined;
    render();
  });

  document.querySelector<HTMLInputElement>("#sync-lan-share-pass")?.addEventListener("input", (ev) => {
    if (modal.kind !== "sync") return;
    modal.lanSharePassDraft = (ev.currentTarget as HTMLInputElement).value;
    modal.error = undefined;
  });

  document.querySelector<HTMLInputElement>("#sync-lan-pull-addr")?.addEventListener("input", (ev) => {
    if (modal.kind !== "sync") return;
    const val = (ev.currentTarget as HTMLInputElement).value;
    modal.lanPullAddrDraft = val;
    const hashIdx = val.indexOf("#");
    if (val.trim().startsWith("maam-sync://") && hashIdx > 0) {
      const addrPart = val.slice(0, hashIdx).trim();
      const frag = val.slice(hashIdx + 1).trim();
      if (frag) {
        try {
          modal.lanPullAddrDraft = addrPart;
          modal.lanPullPassDraft = decodeURIComponent(frag);
          (ev.currentTarget as HTMLInputElement).value = modal.lanPullAddrDraft;
          const passEl = document.querySelector<HTMLInputElement>("#sync-lan-pull-pass");
          if (passEl) passEl.value = modal.lanPullPassDraft;
        } catch {
        }
      }
    }
    modal.error = undefined;
  });

  document.querySelector<HTMLInputElement>("#sync-lan-pull-pass")?.addEventListener("input", (ev) => {
    if (modal.kind !== "sync") return;
    modal.lanPullPassDraft = (ev.currentTarget as HTMLInputElement).value;
    modal.error = undefined;
  });

  document.querySelector<HTMLInputElement>("#sync-file-export-pass")?.addEventListener("input", (ev) => {
    if (modal.kind !== "sync") return;
    modal.fileExportPassDraft = (ev.currentTarget as HTMLInputElement).value;
    modal.error = undefined;
  });

  document.querySelector<HTMLInputElement>("#sync-file-import-pass")?.addEventListener("input", (ev) => {
    if (modal.kind !== "sync") return;
    modal.fileImportPassDraft = (ev.currentTarget as HTMLInputElement).value;
    modal.error = undefined;
  });

  document.querySelector<HTMLTextAreaElement>("#sync-file-import-json")?.addEventListener("input", (ev) => {
    if (modal.kind !== "sync") return;
    modal.fileImportJsonDraft = (ev.currentTarget as HTMLTextAreaElement).value;
    modal.error = undefined;
  });

  document.querySelector<HTMLInputElement>("#sync-file-picker")?.addEventListener("change", async (ev) => {
    const cur = modal;
    if (cur.kind !== "sync") return;
    const inputEl = ev.currentTarget as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (modal !== cur) return;
      cur.fileImportFileName = file.name;
      cur.fileImportJsonDraft = text;
      cur.error = undefined;
      render();
    } catch (err) {
      if (modal !== cur) return;
      cur.error = `Failed to read backup file: ${String(err)}`;
      render();
    }
  });

  document.querySelector("#sync-lan-start-btn")?.addEventListener("click", async () => {
    const cur = modal;
    if (cur.kind !== "sync" || cur.lanShareBusy) return;
    cur.lanShareBusy = true;
    cur.error = undefined;
    cur.copyHint = undefined;
    render();
    try {
      const info = cur.relayEnabled
        ? await invoke<LanSyncShareInfo>("start_relay_sync_share", {
            relayUrl: cur.relayUrlDraft.trim() || null,
          })
        : await invoke<LanSyncShareInfo>("start_lan_sync_share", {
            passphrase: cur.lanSharePassDraft.trim() || null,
          });
      if (modal === cur) {
        cur.lanShareInfo = info;
      }
    } catch (err) {
      if (modal === cur) cur.error = String(err);
    } finally {
      if (modal === cur) {
        cur.lanShareBusy = false;
        render();
      }
    }
  });

  document.querySelector("#sync-lan-stop-btn")?.addEventListener("click", async () => {
    const cur = modal;
    if (cur.kind !== "sync") return;
    await invoke("stop_lan_sync_share").catch(() => {});
    if (modal === cur) {
      cur.lanShareInfo = null;
      cur.copyHint = undefined;
      render();
    }
  });

  document.querySelector("#sync-lan-copy-uri-btn")?.addEventListener("click", async () => {
    const cur = modal;
    if (cur.kind !== "sync" || !cur.lanShareInfo) return;
    try {
      await navigator.clipboard.writeText(cur.lanShareInfo.syncUri);
      cur.copyHint = "Sync URI copied (paste into the address field on another device)";
    } catch {
      cur.copyHint = "Copy failed. Please copy the address and passcode manually";
    }
    render();
  });

  document.querySelector("#sync-lan-scan-btn")?.addEventListener("click", async () => {
    const cur = modal;
    if (cur.kind !== "sync" || cur.lanScanBusy || cur.lanPullBusy) return;
    cur.lanScanBusy = true;
    cur.error = undefined;
    cur.copyHint = undefined;
    cur.importSummary = null;
    render();
    try {
      const scanned = await invoke<ScanQrResult>("scan_sync_qr_code");
      if (modal !== cur || scanned.cancelled) return;
      const raw = (scanned.content || "").trim();
      if (!raw) {
        cur.error = "No valid sync QR code content detected";
        return;
      }
      let parsedAddr = raw;
      let parsedPass = cur.lanPullPassDraft.trim();
      const hashIdx = raw.indexOf("#");
      if (hashIdx > 0) {
        parsedAddr = raw.slice(0, hashIdx).trim();
        const frag = raw.slice(hashIdx + 1).trim();
        if (frag) {
          try {
            parsedPass = decodeURIComponent(frag);
          } catch {
            parsedPass = frag;
          }
        }
      }
      cur.lanPullAddrDraft = parsedAddr;
      if (parsedPass) {
        cur.lanPullPassDraft = parsedPass;
      }
      if (!parsedPass) {
        cur.copyHint = "Sync address recognized. Enter the passcode and click \"Pull & Merge\"";
        return;
      }
      cur.lanPullBusy = true;
      render();
      const res = await invoke<ImportSyncBundleResponse>("pull_lan_sync_share", {
        address: parsedAddr,
        passphrase: parsedPass,
      });
      snapshot = res.snapshot;
      syncViewModeFromSnapshot(snapshot);
      if (modal === cur) {
        cur.importSummary = res.summary;
      }
    } catch (err) {
      if (modal === cur) cur.error = String(err);
    } finally {
      if (modal === cur) {
        cur.lanScanBusy = false;
        cur.lanPullBusy = false;
        render();
      }
    }
  });

  document.querySelector("#sync-lan-pull-btn")?.addEventListener("click", async () => {
    const cur = modal;
    if (cur.kind !== "sync" || cur.lanPullBusy) return;
    cur.lanPullBusy = true;
    cur.error = undefined;
    cur.importSummary = null;
    render();
    try {
      const res = await invoke<ImportSyncBundleResponse>("pull_lan_sync_share", {
        address: cur.lanPullAddrDraft.trim(),
        passphrase: cur.lanPullPassDraft.trim(),
      });
      snapshot = res.snapshot;
      syncViewModeFromSnapshot(snapshot);
      if (modal === cur) {
        cur.importSummary = res.summary;
      }
    } catch (err) {
      if (modal === cur) cur.error = String(err);
    } finally {
      if (modal === cur) {
        cur.lanPullBusy = false;
        render();
      }
    }
  });

  document.querySelector("#sync-file-export-btn")?.addEventListener("click", async () => {
    const cur = modal;
    if (cur.kind !== "sync" || cur.fileExportBusy) return;
    cur.fileExportBusy = true;
    cur.error = undefined;
    cur.copyHint = undefined;
    render();
    try {
      const res = await invoke<ExportSyncBundleResponse>("export_sync_bundle", {
        passphrase: cur.fileExportPassDraft,
      });
      if (modal === cur) {
        cur.fileExportResult = res;
      }
    } catch (err) {
      if (modal === cur) cur.error = String(err);
    } finally {
      if (modal === cur) {
        cur.fileExportBusy = false;
        render();
      }
    }
  });

  document.querySelector("#sync-file-reveal-btn")?.addEventListener("click", async () => {
    if (modal.kind !== "sync" || modal.fileExportResult?.downloadId == null) return;
    await invoke("reveal_downloaded_file", {
      downloadId: modal.fileExportResult.downloadId,
    }).catch(() => {});
  });

  document.querySelector("#sync-file-download-btn")?.addEventListener("click", () => {
    if (modal.kind !== "sync" || !modal.fileExportResult) return;
    const res = modal.fileExportResult;
    const blob = new Blob([res.bundleJson], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.querySelector("#sync-file-copy-btn")?.addEventListener("click", async () => {
    const cur = modal;
    if (cur.kind !== "sync" || !cur.fileExportResult) return;
    try {
      await navigator.clipboard.writeText(cur.fileExportResult.bundleJson);
      cur.copyHint = "Encrypted backup content copied";
    } catch {
      cur.copyHint = "Copy failed. Please click Save .maam File";
    }
    render();
  });

  document.querySelector("#sync-file-import-btn")?.addEventListener("click", async () => {
    const cur = modal;
    if (cur.kind !== "sync" || cur.fileImportBusy) return;
    cur.fileImportBusy = true;
    cur.error = undefined;
    cur.importSummary = null;
    render();
    try {
      const res = await invoke<ImportSyncBundleResponse>("import_sync_bundle", {
        bundleJson: cur.fileImportJsonDraft,
        passphrase: cur.fileImportPassDraft,
      });
      snapshot = res.snapshot;
      syncViewModeFromSnapshot(snapshot);
      if (modal === cur) {
        cur.importSummary = res.summary;
      }
    } catch (err) {
      if (modal === cur) cur.error = String(err);
    } finally {
      if (modal === cur) {
        cur.fileImportBusy = false;
        render();
      }
    }
  });

  document.querySelector("#smart-switch-btn")?.addEventListener("click", async () => {
    if (modal.kind !== "none" || state.conflicts.length > 0) return;
    const candidates = state.accounts.filter((a) => a.providerId === provider.id);
    if (candidates.length === 0) return;
    const ranked = [...candidates]
      .filter((a) => scoreAccountAvailability(a, findAccountPageError(state, a)).available)
      .sort((a, b) => compareAccountAvailability(a, b, state));
    const best = ranked[0];
    if (!best) {
      if (snapshot) {
        snapshot = { ...snapshot, notice: "No available signed-in account found. Please sign in or wait for sync." };
        rerenderPreservingScroll();
      }
      return;
    }
    if (isSameKey(state.activeAccount, best)) {
      if (snapshot) {
        snapshot = {
          ...snapshot,
          notice: "Current account already has the highest remaining quota",
        };
        rerenderPreservingScroll();
      }
      return;
    }
    const alreadyWarm = state.warmAccounts.some(
      (k) => k.providerId === best.providerId && k.uuid === best.uuid
    );
    await callCommand(
      "switch_account",
      { providerId: best.providerId, uuid: best.uuid },
      alreadyWarm ? null : { providerId: best.providerId, uuid: best.uuid }
    );
  });

  document.querySelector("#sort-quota-btn")?.addEventListener("click", async () => {
    if (modal.kind !== "none" || state.conflicts.length > 0) return;
    const candidates = state.accounts.filter((a) => a.providerId === provider.id);
    if (candidates.length <= 1) return;
    const sorted = [...candidates].sort((a, b) => compareAccountAvailability(a, b, state));
    const orderedUuids = sorted.map((a) => a.uuid);
    const changed = orderedUuids.some((u, idx) => u !== candidates[idx].uuid);
    if (!changed) {
      if (snapshot) {
        snapshot = {
          ...snapshot,
          notice: "Accounts are already sorted by remaining quota (high to low)",
        };
        rerenderPreservingScroll();
      }
      return;
    }
    await callCommand("reorder_accounts", {
      providerId: provider.id,
      orderedUuids,
    });
  });

  const openOfficial = async () => {
    await callCommand("open_official_site", { providerId: provider.id });
  };
  document.querySelector("#open-site-btn")?.addEventListener("click", openOfficial);
  document.querySelector("#stage-open-site-btn")?.addEventListener("click", openOfficial);

  document.querySelector("#sync-all-btn")?.addEventListener("click", async () => {
    const btn = document.querySelector("#sync-all-btn");
    btn?.classList.add("spinning");
    try {
      await callCommand("trigger_quota_sync");
    } finally {
      setTimeout(() => btn?.classList.remove("spinning"), 650);
    }
  });

  const openAddModal = async () => {
    await setModal({ kind: "add", providerId: provider.id, draft: "", proxyDraft: "", timezoneDraft: "", cookieDraft: "" });
  };
  document.querySelector("#add-account-btn")?.addEventListener("click", openAddModal);
  document.querySelector("#stage-add-btn")?.addEventListener("click", openAddModal);
  document.querySelector("#stage-account-settings-btn")?.addEventListener("click", async () => {
    if (!state.activeAccount) return;
    const acc = state.accounts.find(
      (a) =>
        a.providerId === state.activeAccount!.providerId &&
        a.uuid === state.activeAccount!.uuid
    );
    if (!acc) return;
    await setModal({
      kind: "rename",
      account: acc,
      draft: acc.autoAlias ? "" : acc.alias,
      proxyDraft: acc.proxyUrl ?? "",
      timezoneDraft: acc.timezone ?? "",
      cookieDraft: "",
    });
  });

  document.querySelector("#dismiss-notice-btn")?.addEventListener("click", async () => {
    await callCommand("dismiss_notice");
  });

  const toastEl = document.querySelector("#download-toast");
  if (toastEl) {
    toastEl.addEventListener("mouseenter", () => {
      clearDownloadToastTimer();
    });
    toastEl.addEventListener("mouseleave", () => {
      scheduleDownloadToastDismiss();
    });
  }
  document.querySelector<HTMLButtonElement>("#download-reveal-btn")?.addEventListener("click", async (ev) => {
    const rawId = (ev.currentTarget as HTMLButtonElement).dataset.downloadId;
    const downloadId = rawId ? Number(rawId) : NaN;
    if (!Number.isFinite(downloadId)) return;
    try {
      await invoke<void>("reveal_downloaded_file", { downloadId });
    } catch (err) {
      if (snapshot) {
        snapshot = { ...snapshot, notice: String(err) };
        rerenderPreservingScroll();
      }
    }
  });
  document.querySelector("#download-close-btn")?.addEventListener("click", () => {
    clearDownloadToastTimer();
    downloadToast = null;
    rerenderPreservingScroll();
  });

  document.querySelector("#check-update-btn")?.addEventListener("click", async () => {
    if (modal.kind !== "none") return;
    await setModal({ kind: "update" });
    const stale =
      !updateState.result ||
      (!updateState.result.hasUpdate && Date.now() - updateState.lastCheckedAt > 5 * 60 * 1000);
    if (stale && !updateState.checking && !updateState.installing) {
      await runCheckForUpdates(false);
    }
  });

  document.querySelector("#update-recheck-btn")?.addEventListener("click", async () => {
    await runCheckForUpdates(false);
  });

  document.querySelector("#update-install-btn")?.addEventListener("click", async () => {
    await runDownloadAndInstall();
  });

  document.querySelector("#update-open-page-btn")?.addEventListener("click", async () => {
    const pageUrl = updateState.result?.releasePageUrl;
    if (!pageUrl) return;
    try {
      await invoke("open_external_url", { url: pageUrl });
    } catch (err) {
      updateState.error = String(err);
      rerenderPreservingScroll();
    }
  });

  document.querySelectorAll<HTMLElement>("[data-resolve-uuid]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uuid = btn.dataset.resolveUuid;
      const keepProviderId = btn.dataset.resolveProvider;
      if (uuid && keepProviderId) {
        await callCommand("resolve_uuid_conflict", { keepProviderId, uuid });
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-copy-cookie-uuid]").forEach((button) => {
    let feedbackTimer: number | undefined;
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const uuid = button.dataset.copyCookieUuid;
      if (!uuid) return;
      const copyKey = `${provider.id}:${uuid}`;
      if (copyingCookies.has(copyKey)) return;
      copyingCookies.add(copyKey);
      window.clearTimeout(feedbackTimer);
      button.classList.remove("copied");
      button.dataset.copyLabel = "Copying…";
      try {
        await invoke<void>("copy_account_cookie", { providerId: provider.id, uuid });
        button.dataset.copyLabel = "Copied";
        button.classList.add("copied");
        feedbackTimer = window.setTimeout(() => {
          button.classList.remove("copied");
          button.dataset.copyLabel = "Copy Cookie";
        }, 1800);
      } catch (err) {
        button.dataset.copyLabel = "Copy Cookie";
        if (snapshot?.selectedProviderId === provider.id) {
          snapshot = { ...snapshot, notice: String(err) };
          rerenderPreservingScroll();
        }
      } finally {
        copyingCookies.delete(copyKey);
      }
    });
  });

  document.querySelectorAll<HTMLElement>("[data-reload-uuid]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const uuid = btn.dataset.reloadUuid;
      if (!uuid) return;
      const isActive =
        snapshot?.activeAccount?.providerId === provider.id &&
        snapshot?.activeAccount?.uuid === uuid;
      const optimistic = isActive ? { providerId: provider.id, uuid } : null;
      await callCommand("reload_account", { providerId: provider.id, uuid }, optimistic);
    });
  });

  document.querySelectorAll<HTMLElement>("[data-relogin-uuid]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const uuid = btn.dataset.reloginUuid;
      if (!uuid) return;
      await callCommand(
        "clear_account_data",
        { providerId: provider.id, uuid },
        { providerId: provider.id, uuid }
      );
    });
  });

  document.querySelectorAll<HTMLElement>("[data-rename-uuid]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const uuid = btn.dataset.renameUuid;
      const acc = state.accounts.find((a) => a.providerId === provider.id && a.uuid === uuid);
      if (acc) {
        await setModal({
          kind: "rename",
          account: acc,
          draft: acc.autoAlias ? "" : acc.alias,
          proxyDraft: acc.proxyUrl ?? "",
          timezoneDraft: acc.timezone ?? "",
          cookieDraft: "",
        });
      }
    });
  });

  document.querySelectorAll<HTMLElement>("[data-remove-uuid]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const uuid = btn.dataset.removeUuid;
      const acc = state.accounts.find((a) => a.providerId === provider.id && a.uuid === uuid);
      if (acc) {
        await setModal({ kind: "remove", account: acc });
      }
    });
  });

  document.querySelectorAll<HTMLElement>(".row-ops").forEach((ops) => {
    ops.addEventListener("click", (ev) => {
      ev.stopPropagation();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-move-uuid]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (modal.kind !== "none" || state.conflicts.length > 0) return;
      const uuid = btn.dataset.moveUuid;
      const dir = btn.dataset.moveDir;
      if (!uuid || (dir !== "up" && dir !== "down")) return;
      const ordered = state.accounts
        .filter((a) => a.providerId === provider.id)
        .map((a) => a.uuid);
      const idx = ordered.indexOf(uuid);
      if (idx === -1) return;
      const targetIdx = dir === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= ordered.length) return;
      [ordered[idx], ordered[targetIdx]] = [ordered[targetIdx], ordered[idx]];
      await callCommand("reorder_accounts", {
        providerId: provider.id,
        orderedUuids: ordered,
      });
    });
  });

  document.querySelectorAll<HTMLElement>("[data-switch-uuid]").forEach((row) => {
    row.addEventListener("dragstart", (ev) => {
      if (isMobilePlatform(state.platform) || modal.kind !== "none" || state.conflicts.length > 0 || busy) {
        ev.preventDefault();
        return;
      }
      const uuid = row.dataset.switchUuid;
      if (!uuid) {
        ev.preventDefault();
        return;
      }
      draggingAccountUuid = uuid;
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", uuid);
      }
      requestAnimationFrame(() => row.classList.add("dragging"));
    });

    row.addEventListener("dragover", (ev) => {
      if (!draggingAccountUuid) return;
      const targetUuid = row.dataset.switchUuid;
      if (!targetUuid || targetUuid === draggingAccountUuid) return;
      ev.preventDefault();
      if (ev.dataTransfer) {
        ev.dataTransfer.dropEffect = "move";
      }
      const rect = row.getBoundingClientRect();
      const insertBefore = ev.clientY < rect.top + rect.height / 2;
      row.classList.toggle("drag-over-top", insertBefore);
      row.classList.toggle("drag-over-bottom", !insertBefore);
    });

    row.addEventListener("dragleave", (ev) => {
      if (row.contains(ev.relatedTarget as Node | null)) return;
      row.classList.remove("drag-over-top", "drag-over-bottom");
    });

    row.addEventListener("drop", async (ev) => {
      if (!draggingAccountUuid) return;
      ev.preventDefault();
      ev.stopPropagation();
      const srcUuid = draggingAccountUuid;
      const targetUuid = row.dataset.switchUuid;
      const insertBefore = row.classList.contains("drag-over-top");
      row.classList.remove("drag-over-top", "drag-over-bottom");
      if (!targetUuid || targetUuid === srcUuid) return;
      const ordered = state.accounts
        .filter((a) => a.providerId === provider.id)
        .map((a) => a.uuid);
      const fromIdx = ordered.indexOf(srcUuid);
      if (fromIdx === -1) return;
      ordered.splice(fromIdx, 1);
      const toIdx = ordered.indexOf(targetUuid);
      if (toIdx === -1) return;
      ordered.splice(insertBefore ? toIdx : toIdx + 1, 0, srcUuid);
      draggingAccountUuid = null;
      await callCommand("reorder_accounts", {
        providerId: provider.id,
        orderedUuids: ordered,
      });
    });

    row.addEventListener("dragend", () => {
      draggingAccountUuid = null;
      document
        .querySelectorAll<HTMLElement>(".account-row.dragging, .account-row.drag-over-top, .account-row.drag-over-bottom")
        .forEach((el) => {
          el.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
        });
    });

    row.addEventListener("click", async () => {
      if (modal.kind !== "none" || state.conflicts.length > 0) return;
      const uuid = row.dataset.switchUuid;
      if (!uuid) return;
      if (
        state.activeAccount?.providerId === provider.id &&
        state.activeAccount?.uuid === uuid &&
        !isMobilePlatform(state.platform)
      ) {
        return;
      }
      const alreadyWarm = state.warmAccounts.some(
        (k) => k.providerId === provider.id && k.uuid === uuid
      );
      await callCommand(
        "switch_account",
        { providerId: provider.id, uuid },
        alreadyWarm ? null : { providerId: provider.id, uuid }
      );
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-shortcut-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (modal.kind !== "settings" || modal.saving) return;
      modal.globalShortcut = btn.dataset.shortcutPreset ?? "";
      modal.error = undefined;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-timezone-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if ((modal.kind !== "add" && modal.kind !== "rename") || modal.saving) return;
      modal.timezoneDraft = btn.dataset.timezonePreset ?? "";
      modal.error = undefined;
      render();
    });
  });

  document.querySelector("#proxy-test-btn")?.addEventListener("click", async () => {
    const currentModal = modal;
    if (currentModal.kind !== "add" && currentModal.kind !== "rename") return;
    if (currentModal.saving || currentModal.proxyTesting) return;
    const pid =
      currentModal.kind === "add" ? currentModal.providerId : currentModal.account.providerId;
    currentModal.proxyTesting = true;
    currentModal.proxyTestResult = null;
    currentModal.error = undefined;
    render();
    try {
      const res = await invoke<ProxyTestResult>("test_account_proxy", {
        providerId: pid,
        proxyUrl: currentModal.proxyDraft.trim(),
      });
      if (modal === currentModal) {
        currentModal.proxyTestResult = res;
      }
    } catch (err) {
      if (modal === currentModal) {
        currentModal.error = String(err);
      }
    } finally {
      currentModal.proxyTesting = false;
      if (modal === currentModal) {
        render();
      }
    }
  });

  document.querySelector("#modal-clear-data-btn")?.addEventListener("click", async () => {
    const currentModal = modal;
    if (currentModal.kind !== "rename" || currentModal.saving) return;
    if (!currentModal.confirmClear) {
      currentModal.confirmClear = true;
      render();
      return;
    }
    currentModal.error = undefined;
    currentModal.saving = true;
    render();
    let cleared = false;
    try {
      cleared = await callCommand("clear_account_data", {
        providerId: currentModal.account.providerId,
        uuid: currentModal.account.uuid,
      });
    } finally {
      currentModal.saving = false;
      if (modal === currentModal && !cleared) {
        currentModal.confirmClear = false;
        render();
      }
    }
    if (cleared && modal === currentModal) {
      await setModal({ kind: "none" });
    }
  });

  document.querySelector<HTMLInputElement>("#modal-tray-checkbox")?.addEventListener("change", (ev) => {
    if (modal.kind === "settings") {
      modal.minimizeToTray = (ev.currentTarget as HTMLInputElement).checked;
    }
  });

  document.querySelector<HTMLInputElement>("#modal-auto-approve-checkbox")?.addEventListener("change", (ev) => {
    if (modal.kind === "settings") {
      modal.autoApprove = (ev.currentTarget as HTMLInputElement).checked;
    }
  });

  document.querySelector<HTMLInputElement>("#modal-isolate-proxy-checkbox")?.addEventListener("change", (ev) => {
    if (modal.kind === "settings") {
      modal.isolateSameProxyKeepAlive = (ev.currentTarget as HTMLInputElement).checked;
    }
  });

  document.querySelector<HTMLInputElement>("#modal-sync-interval-input")?.addEventListener("input", (ev) => {
    if (modal.kind === "settings") {
      const parsed = Number.parseInt((ev.currentTarget as HTMLInputElement).value, 10);
      modal.silentSyncIntervalMins = Number.isFinite(parsed)
        ? Math.min(120, Math.max(0, parsed))
        : 0;
    }
  });

  document.querySelectorAll<HTMLElement>("[data-sync-interval-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (modal.kind !== "settings" || modal.saving) return;
      const parsed = Number.parseInt(btn.dataset.syncIntervalPreset ?? "15", 10);
      modal.silentSyncIntervalMins = Number.isFinite(parsed)
        ? Math.min(120, Math.max(0, parsed))
        : 15;
      const input = document.querySelector<HTMLInputElement>("#modal-sync-interval-input");
      if (input) input.value = String(modal.silentSyncIntervalMins);
    });
  });

  document.querySelector<HTMLTextAreaElement>("#modal-cookie-import-input")?.addEventListener("input", (ev) => {
    if (modal.kind === "add" || modal.kind === "rename") {
      modal.cookieDraft = (ev.currentTarget as HTMLTextAreaElement).value;
      if (modal.error) {
        modal.error = undefined;
        document.querySelector("#modal-error-box")?.remove();
      }
    }
  });

  document.querySelector("#modal-import-cookie-btn")?.addEventListener("click", async () => {
    const currentModal = modal;
    if (currentModal.kind !== "rename" || currentModal.saving || currentModal.cookieImporting) return;
    const raw = (currentModal.cookieDraft ?? "").trim();
    if (!raw) {
      currentModal.error = "Please paste Cookie content to import first";
      render();
      return;
    }
    currentModal.error = undefined;
    currentModal.saving = true;
    currentModal.cookieImporting = true;
    render();
    let imported = false;
    try {
      imported = await callCommand("import_account_cookies", {
        providerId: currentModal.account.providerId,
        uuid: currentModal.account.uuid,
        rawCookies: raw,
      });
    } finally {
      currentModal.saving = false;
      currentModal.cookieImporting = false;
      if (modal === currentModal && !imported) {
        render();
      }
    }
    if (imported && modal === currentModal) {
      await setModal({ kind: "none" });
    }
  });

  document.querySelectorAll<HTMLButtonElement>("[data-toggle-group-member]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (modal.kind !== "group" || modal.saving) return;
      const pid = btn.dataset.memberProvider;
      const uuid = btn.dataset.memberUuid;
      if (!pid || !uuid) return;
      const idx = modal.selectedMembers.findIndex(
        (m) => m.providerId === pid && m.uuid === uuid
      );
      let nowChecked = false;
      if (idx >= 0) {
        modal.selectedMembers.splice(idx, 1);
        nowChecked = false;
      } else {
        if (modal.selectedMembers.length >= 30) {
          modal.error = "A group chat supports up to 30 members";
          rerenderPreservingScroll();
          return;
        }
        modal.selectedMembers.push({ providerId: pid, uuid });
        nowChecked = true;
      }
      modal.error = undefined;
      btn.classList.toggle("selected", nowChecked);
      const checkBoxEl = btn.querySelector<HTMLElement>(".group-check-box");
      if (checkBoxEl) {
        checkBoxEl.textContent = nowChecked ? "✓" : "";
      }
      const hintEl = document.querySelector<HTMLElement>("#modal-group-hint");
      if (hintEl) {
        const extCount = (state.externalAgents ?? []).length;
        const eligibleCount =
          state.accounts.filter((a) => isAccountGroupEligible(state, a)).length + extCount;
        const ineligibleCount = state.accounts.length + extCount - eligibleCount;
        hintEl.textContent = formatGroupPickerHint(
          eligibleCount,
          ineligibleCount,
          modal.selectedMembers.length,
          true
        );
      }
      const confirmBtn = document.querySelector<HTMLButtonElement>("#modal-confirm-btn");
      if (confirmBtn) {
        confirmBtn.disabled = modal.selectedMembers.length === 0;
      }
      document.querySelector("#modal-error-box")?.remove();
    });
  });

  const commitKnowledgeSkillDraft = (
    kModal: Extract<ModalMode, { kind: "group-knowledge" }>
  ): boolean => {
    const name = kModal.skillNameDraft.trim();
    const desc = kModal.skillDescDraft.trim();
    const content = kModal.skillContentDraft.trim();
    if (!name || !content) {
      kModal.error = !name ? "Please enter a skill name" : "Please enter skill instructions";
      return false;
    }
    if (kModal.editingSkillId) {
      const idx = kModal.skillsDraft.findIndex((s) => s.id === kModal.editingSkillId);
      if (idx >= 0) {
        kModal.skillsDraft[idx] = {
          ...kModal.skillsDraft[idx],
          name,
          description: desc,
          content,
        };
      }
    } else {
      if (kModal.skillsDraft.length >= 30) {
        kModal.error = "A group chat supports up to 30 shared skills";
        return false;
      }
      kModal.skillsDraft.push({
        id: `skill_${Date.now()}_${kModal.skillsDraft.length}`,
        name,
        description: desc,
        content,
        enabled: true,
      });
    }
    kModal.skillNameDraft = "";
    kModal.skillDescDraft = "";
    kModal.skillContentDraft = "";
    kModal.editingSkillId = null;
    kModal.error = undefined;
    return true;
  };

  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-tab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (modal.kind !== "group-knowledge" || modal.saving) return;
      const nextTab = btn.dataset.knowledgeTab as
        | "context"
        | "skills"
        | "roles"
        | "adapters"
        | undefined;
      if (nextTab && modal.tab !== nextTab) {
        modal.tab = nextTab;
        modal.error = undefined;
        render();
        if (nextTab === "adapters" && !modal.adaptersLoaded) {
          const currentModal = modal;
          try {
            const snap = await invoke<SiteAdaptersSnapshot>("get_site_adapters");
            if (modal === currentModal) {
              currentModal.adaptersSnap = snap;
              currentModal.adaptersJsonDraft = snap.overrideJson ?? "";
              currentModal.adaptersLoaded = true;
              render();
            }
          } catch (err) {
            if (modal === currentModal) {
              currentModal.error = String(err);
              currentModal.adaptersLoaded = true;
              render();
            }
          }
        }
      }
    });
  });

  const contextInputEl = document.querySelector<HTMLTextAreaElement>("#modal-group-context-input");
  contextInputEl?.addEventListener("input", () => {
    if (modal.kind !== "group-knowledge") return;
    modal.contextDraft = contextInputEl.value;
    const countEl = document.querySelector<HTMLElement>("#modal-group-context-count");
    if (countEl) {
      countEl.textContent = String(contextInputEl.value.length);
    }
    if (modal.error) {
      modal.error = undefined;
      document.querySelector("#modal-error-box")?.remove();
    }
  });

  document.querySelectorAll<HTMLButtonElement>("[data-add-skill-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (modal.kind !== "group-knowledge" || modal.saving) return;
      const idx = Number(btn.dataset.addSkillPreset ?? "-1");
      const preset = GROUP_SKILL_PRESETS[idx];
      if (!preset) return;
      if (modal.skillsDraft.some((s) => s.name === preset.name)) return;
      if (modal.skillsDraft.length >= 30) {
        modal.error = "A group chat supports up to 30 shared skills";
        render();
        return;
      }
      modal.skillsDraft.push({
        id: `skill_${Date.now()}_${idx}`,
        name: preset.name,
        description: preset.description,
        content: preset.content,
        enabled: true,
      });
      modal.error = undefined;
      render();
    });
  });

  document.querySelectorAll<HTMLInputElement>("[data-toggle-skill-id]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (modal.kind !== "group-knowledge" || modal.saving) return;
      const sid = cb.dataset.toggleSkillId;
      const target = modal.skillsDraft.find((s) => s.id === sid);
      if (target) {
        target.enabled = cb.checked;
        modal.error = undefined;
        render();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-edit-skill-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (modal.kind !== "group-knowledge" || modal.saving) return;
      const sid = btn.dataset.editSkillId;
      const target = modal.skillsDraft.find((s) => s.id === sid);
      if (!target) return;
      modal.editingSkillId = target.id;
      modal.skillNameDraft = target.name;
      modal.skillDescDraft = target.description;
      modal.skillContentDraft = target.content;
      modal.error = undefined;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-delete-skill-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (modal.kind !== "group-knowledge" || modal.saving) return;
      const sid = btn.dataset.deleteSkillId;
      modal.skillsDraft = modal.skillsDraft.filter((s) => s.id !== sid);
      if (modal.editingSkillId === sid) {
        modal.editingSkillId = null;
        modal.skillNameDraft = "";
        modal.skillDescDraft = "";
        modal.skillContentDraft = "";
      }
      modal.error = undefined;
      render();
    });
  });

  document
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "#modal-skill-name-input, #modal-skill-desc-input, #modal-skill-content-input"
    )
    .forEach((el) => {
      el.addEventListener("input", () => {
        if (modal.kind !== "group-knowledge") return;
        if (el.id === "modal-skill-name-input") modal.skillNameDraft = el.value;
        else if (el.id === "modal-skill-desc-input") modal.skillDescDraft = el.value;
        else modal.skillContentDraft = el.value;
        if (modal.error) {
          modal.error = undefined;
          document.querySelector("#modal-error-box")?.remove();
        }
      });
    });

  document.querySelector("#modal-skill-save-btn")?.addEventListener("click", () => {
    if (modal.kind !== "group-knowledge" || modal.saving) return;
    commitKnowledgeSkillDraft(modal);
    render();
  });

  document.querySelector("#modal-skill-cancel-edit-btn")?.addEventListener("click", () => {
    if (modal.kind !== "group-knowledge" || modal.saving) return;
    modal.editingSkillId = null;
    modal.skillNameDraft = "";
    modal.skillDescDraft = "";
    modal.skillContentDraft = "";
    modal.error = undefined;
    render();
  });

  document.querySelectorAll<HTMLInputElement>("[data-role-provider]").forEach((input) => {
    input.addEventListener("input", () => {
      if (modal.kind !== "group-knowledge") return;
      const pid = input.dataset.roleProvider;
      const uuid = input.dataset.roleUuid;
      if (!pid || !uuid) return;
      const key: AccountKey = { providerId: pid, uuid };
      const existing = modal.rolesDraft.find((r) => sameAccountKey(r.member, key));
      if (existing) {
        existing.role = input.value;
      } else {
        modal.rolesDraft.push({ member: key, role: input.value });
      }
      if (modal.error) {
        modal.error = undefined;
        document.querySelector("#modal-error-box")?.remove();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-reset-thread-provider]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (modal.kind !== "group-knowledge" || modal.saving) return;
      const providerId = btn.dataset.resetThreadProvider;
      const uuid = btn.dataset.resetThreadUuid;
      if (!providerId || !uuid) return;
      const currentModal = modal;
      currentModal.saving = true;
      currentModal.error = undefined;
      render();
      try {
        await callCommand("reset_group_thread_binding", {
          groupId: currentModal.group.id,
          member: { providerId, uuid },
        });
      } finally {
        currentModal.saving = false;
        render();
      }
    });
  });

  const adaptersJsonEl = document.querySelector<HTMLTextAreaElement>("#modal-adapters-json-input");
  adaptersJsonEl?.addEventListener("input", () => {
    if (modal.kind !== "group-knowledge") return;
    modal.adaptersJsonDraft = adaptersJsonEl.value;
    if (modal.error) {
      modal.error = undefined;
      document.querySelector("#modal-error-box")?.remove();
    }
  });

  document.querySelector("#modal-adapters-reset-btn")?.addEventListener("click", async () => {
    if (modal.kind !== "group-knowledge" || modal.saving) return;
    const currentModal = modal;
    currentModal.saving = true;
    currentModal.error = undefined;
    render();
    try {
      const snap = await invoke<SiteAdaptersSnapshot>("reset_site_adapter_overrides");
      if (modal === currentModal) {
        currentModal.adaptersSnap = snap;
        currentModal.adaptersJsonDraft = snap.overrideJson ?? "";
      }
    } catch (err) {
      if (modal === currentModal) {
        currentModal.error = String(err);
      }
    } finally {
      currentModal.saving = false;
      render();
    }
  });

  document.querySelectorAll<HTMLButtonElement>("[data-ext-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (modal.kind !== "external-agents" || modal.saving) return;
      const nextKind = btn.dataset.extKind as ExternalAgentKind | undefined;
      if (nextKind && modal.formKind !== nextKind) {
        modal.formKind = nextKind;
        modal.error = undefined;
        render();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-ext-preset-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (modal.kind !== "external-agents" || modal.saving) return;
      const idx = Number(btn.dataset.extPresetIdx ?? "-1");
      const preset = EXTERNAL_AGENT_PRESETS[idx];
      if (!preset) return;
      modal.formKind = preset.kind;
      modal.nameDraft = preset.name;
      modal.baseUrlDraft = preset.baseUrl ?? "";
      modal.modelDraft = preset.model ?? "";
      modal.commandDraft = preset.command ?? "";
      modal.argsDraft = preset.args ?? "";
      modal.error = undefined;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-edit-ext-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (modal.kind !== "external-agents" || modal.saving) return;
      const eid = btn.dataset.editExtId;
      const ext = (state.externalAgents ?? []).find((a) => a.id === eid);
      if (!ext) return;
      modal.editingId = ext.id;
      modal.formKind = ext.kind;
      modal.nameDraft = ext.name;
      modal.baseUrlDraft = ext.baseUrl;
      modal.apiKeyDraft = ext.apiKey;
      modal.modelDraft = ext.model;
      modal.commandDraft = ext.command;
      modal.argsDraft = ext.args.join(" ");
      modal.workdirDraft = ext.workdir ?? "";
      modal.error = undefined;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-delete-ext-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (modal.kind !== "external-agents" || modal.saving) return;
      const eid = btn.dataset.deleteExtId;
      if (!eid) return;
      const currentModal = modal;
      currentModal.saving = true;
      currentModal.error = undefined;
      render();
      try {
        const deleted = await callCommand("delete_external_agent", { id: eid });
        if (deleted && modal === currentModal && currentModal.editingId === eid) {
          currentModal.editingId = null;
          currentModal.nameDraft = "";
          currentModal.baseUrlDraft = "";
          currentModal.apiKeyDraft = "";
          currentModal.modelDraft = "";
          currentModal.commandDraft = "";
          currentModal.argsDraft = "";
          currentModal.workdirDraft = "";
        }
      } finally {
        currentModal.saving = false;
        render();
      }
    });
  });

  document.querySelector("#ext-agent-cancel-edit-btn")?.addEventListener("click", () => {
    if (modal.kind !== "external-agents" || modal.saving) return;
    modal.editingId = null;
    modal.nameDraft = "";
    modal.baseUrlDraft = "";
    modal.apiKeyDraft = "";
    modal.modelDraft = "";
    modal.commandDraft = "";
    modal.argsDraft = "";
    modal.workdirDraft = "";
    modal.error = undefined;
    render();
  });

  document
    .querySelectorAll<HTMLInputElement>(
      "#ext-agent-name-input, #ext-agent-url-input, #ext-agent-key-input, #ext-agent-model-input, #ext-agent-cmd-input, #ext-agent-args-input, #ext-agent-workdir-input"
    )
    .forEach((input) => {
      input.addEventListener("input", () => {
        if (modal.kind !== "external-agents") return;
        if (input.id === "ext-agent-name-input") modal.nameDraft = input.value;
        else if (input.id === "ext-agent-url-input") modal.baseUrlDraft = input.value;
        else if (input.id === "ext-agent-key-input") modal.apiKeyDraft = input.value;
        else if (input.id === "ext-agent-model-input") modal.modelDraft = input.value;
        else if (input.id === "ext-agent-cmd-input") modal.commandDraft = input.value;
        else if (input.id === "ext-agent-args-input") modal.argsDraft = input.value;
        else if (input.id === "ext-agent-workdir-input") modal.workdirDraft = input.value;
        if (modal.error) {
          modal.error = undefined;
          document.querySelector("#modal-error-box")?.remove();
        }
      });
    });

  document.querySelector("#ext-agent-save-btn")?.addEventListener("click", async () => {
    if (modal.kind !== "external-agents" || modal.saving) return;
    const currentModal = modal;
    currentModal.saving = true;
    currentModal.error = undefined;
    render();
    try {
      const args = currentModal.argsDraft.trim()
        ? currentModal.argsDraft.trim().split(/\s+/)
        : [];
      const saved = await callCommand("upsert_external_agent", {
        id: currentModal.editingId,
        kind: currentModal.formKind,
        name: currentModal.nameDraft.trim(),
        baseUrl: currentModal.baseUrlDraft.trim(),
        apiKey: currentModal.apiKeyDraft.trim(),
        model: currentModal.modelDraft.trim(),
        command: currentModal.commandDraft.trim(),
        args,
        workdir: currentModal.workdirDraft.trim() || null,
      });
      if (saved && modal === currentModal) {
        currentModal.editingId = null;
        currentModal.nameDraft = "";
        currentModal.baseUrlDraft = "";
        currentModal.apiKeyDraft = "";
        currentModal.modelDraft = "";
        currentModal.commandDraft = "";
        currentModal.argsDraft = "";
        currentModal.workdirDraft = "";
      }
    } finally {
      currentModal.saving = false;
      render();
    }
  });

  document
    .querySelectorAll<HTMLInputElement>(
      "#modal-alias-input, #modal-proxy-input, #modal-timezone-input, #modal-shortcut-input, #modal-group-name-input"
    )
    .forEach((input) => {
      input.addEventListener("input", () => {
        if (modal.kind === "add" || modal.kind === "rename") {
          if (input.id === "modal-proxy-input") {
            modal.proxyDraft = input.value;
            modal.proxyTestResult = null;
            document.querySelector("#proxy-test-result")?.remove();
          } else if (input.id === "modal-timezone-input") {
            modal.timezoneDraft = input.value;
          } else {
            modal.draft = input.value;
          }
          if (modal.error) {
            modal.error = undefined;
            document.querySelector("#modal-error-box")?.remove();
          }
        } else if (modal.kind === "group") {
          modal.nameDraft = input.value;
          if (modal.error) {
            modal.error = undefined;
            document.querySelector("#modal-error-box")?.remove();
          }
        } else if (modal.kind === "settings") {
          modal.globalShortcut = input.value;
          if (modal.error) {
            modal.error = undefined;
            document.querySelector("#modal-error-box")?.remove();
          }
        }
      });
      input.addEventListener("keydown", async (ev) => {
        if (ev.key === "Enter" && !ev.isComposing) {
          ev.preventDefault();
          document.querySelector<HTMLButtonElement>("#modal-confirm-btn")?.click();
        } else if (ev.key === "Escape") {
          if (
            (modal.kind === "add" ||
              modal.kind === "rename" ||
              modal.kind === "group" ||
              modal.kind === "settings") &&
            modal.saving
          ) {
            return;
          }
          ev.preventDefault();
          ev.stopPropagation();
          await setModal({ kind: "none" });
        }
      });
    });

  document.querySelector("#modal-cancel-btn")?.addEventListener("click", async () => {
    if (modal.kind === "update" && updateState.installing) return;
    if (
      modal.kind === "sync" &&
      (modal.lanShareBusy ||
        modal.lanPullBusy ||
        modal.lanScanBusy ||
        modal.fileExportBusy ||
        modal.fileImportBusy)
    ) {
      return;
    }
    if (
      (modal.kind === "add" ||
        modal.kind === "rename" ||
        modal.kind === "group" ||
        modal.kind === "group-knowledge" ||
        modal.kind === "external-agents" ||
        modal.kind === "settings") &&
      modal.saving
    ) {
      return;
    }
    await setModal({ kind: "none" });
  });

  document.querySelector("#modal-confirm-btn")?.addEventListener("click", async () => {
    const currentModal = modal;
    if (currentModal.kind === "add" || currentModal.kind === "rename") {
      if (currentModal.saving) return;
      const supportsProxy = supportsAccountProxy(state.platform);
      const alias = currentModal.draft.trim();
      const proxyUrl = supportsProxy ? currentModal.proxyDraft.trim() : undefined;
      const timezone = currentModal.timezoneDraft.trim();
      currentModal.error = undefined;
      currentModal.saving = true;
      render();
      let saved = false;
      try {
        const rawCookies = (currentModal.cookieDraft ?? "").trim();
        saved = currentModal.kind === "add"
          ? await callCommand("add_account", {
            providerId: currentModal.providerId,
            alias,
            proxyUrl,
            timezone,
            rawCookies: rawCookies || undefined,
          })
          : await callCommand("rename_account", {
            providerId: currentModal.account.providerId,
            uuid: currentModal.account.uuid,
            alias,
            proxyUrl,
            timezone,
          });
      } finally {
        currentModal.saving = false;
        if (modal === currentModal && !saved) {
          render();
        }
      }
      if (saved && modal === currentModal) {
        await setModal({ kind: "none" });
      }
    } else if (currentModal.kind === "settings") {
      if (currentModal.saving) return;
      currentModal.error = undefined;
      currentModal.saving = true;
      render();
      let saved = false;
      try {
        saved = await callCommand("update_app_settings", {
          minimizeToTray: currentModal.minimizeToTray,
          globalShortcut: currentModal.globalShortcut.trim(),
          autoApprove: currentModal.autoApprove,
          isolateSameProxyKeepAlive: currentModal.isolateSameProxyKeepAlive,
          silentSyncIntervalMins: currentModal.silentSyncIntervalMins,
        });
      } finally {
        currentModal.saving = false;
        if (modal === currentModal && !saved) {
          render();
        }
      }
      if (saved && modal === currentModal) {
        await setModal({ kind: "none" });
      }
    } else if (currentModal.kind === "group") {
      if (currentModal.saving) return;
      currentModal.error = undefined;
      currentModal.saving = true;
      render();
      let saved = false;
      try {
        if (currentModal.group) {
          saved = await callCommand("update_group_chat", {
            groupId: currentModal.group.id,
            name: currentModal.nameDraft.trim(),
            members: currentModal.selectedMembers,
          });
        } else {
          viewMode = "groups";
          saved = await callCommand("create_group_chat", {
            name: currentModal.nameDraft.trim(),
            members: currentModal.selectedMembers,
          });
        }
      } finally {
        currentModal.saving = false;
        if (modal === currentModal && !saved) {
          render();
        }
      }
      if (saved && modal === currentModal) {
        await setModal({ kind: "none" });
      }
    } else if (currentModal.kind === "group-knowledge") {
      if (currentModal.saving) return;
      if (currentModal.tab === "adapters") {
        currentModal.saving = true;
        currentModal.error = undefined;
        render();
        let saved = false;
        try {
          const snap = await invoke<SiteAdaptersSnapshot>("save_site_adapter_overrides", {
            rawJson: currentModal.adaptersJsonDraft,
          });
          if (modal === currentModal) {
            currentModal.adaptersSnap = snap;
            currentModal.adaptersJsonDraft = snap.overrideJson ?? "";
            saved = true;
          }
        } catch (err) {
          if (modal === currentModal) {
            currentModal.error = String(err);
          }
        } finally {
          currentModal.saving = false;
          if (modal === currentModal && !saved) {
            render();
          }
        }
        if (saved && modal === currentModal) {
          await setModal({ kind: "none" });
        }
        return;
      }
      if (currentModal.skillNameDraft.trim() || currentModal.skillContentDraft.trim()) {
        if (!commitKnowledgeSkillDraft(currentModal)) {
          render();
          return;
        }
      }
      currentModal.saving = true;
      currentModal.error = undefined;
      render();
      let saved = false;
      try {
        saved = await callCommand("update_group_knowledge", {
          groupId: currentModal.group.id,
          sharedContext: currentModal.contextDraft.trim(),
          sharedSkills: currentModal.skillsDraft,
          memberRoles: currentModal.rolesDraft
            .map((r) => ({ member: r.member, role: r.role.trim() }))
            .filter((r) => r.role.length > 0),
        });
      } finally {
        currentModal.saving = false;
        if (modal === currentModal && !saved) {
          render();
        }
      }
      if (saved && modal === currentModal) {
        await setModal({ kind: "none" });
      }
    } else if (currentModal.kind === "delete-group") {
      await setModal({ kind: "none" });
      await callCommand("delete_group_chat", { groupId: currentModal.group.id });
    } else if (currentModal.kind === "remove") {
      await setModal({ kind: "none" });
      await callCommand("remove_account", {
        providerId: currentModal.account.providerId,
        uuid: currentModal.account.uuid,
      });
    }
  });
}

function groupModalVisualSignature(s: ManagerSnapshot): string {
  return JSON.stringify({
    selectedProviderId: s.selectedProviderId,
    activeGroupId: s.activeGroupId,
    notice: s.notice,
    conflicts: s.conflicts,
    providers: s.providers.map((p) => [p.id, p.enabled, p.shortName]),
    accounts: s.accounts.map((a) => [
      a.providerId,
      a.uuid,
      a.alias,
      a.authState,
      a.avatarUrl,
      a.cookieExpiresAtMs,
      a.cookieSessionOnly,
    ]),
    accountErrors: s.accountErrors,
    externalAgents: (s.externalAgents ?? []).map((e) => [
      e.id,
      e.kind,
      e.name,
      e.model,
      e.command,
    ]),
    groupChats: s.groupChats.map((g) => {
      const lastMsg = g.messages[g.messages.length - 1];
      return [
        g.id,
        g.name,
        g.members.length,
        g.messages.length,
        lastMsg ? [lastMsg.id, lastMsg.status, lastMsg.content.length] : null,
      ];
    }),
  });
}

async function bootstrap(): Promise<void> {
  await listen<ManagerSnapshot>("manager-state-changed", (event) => {
    const prevSnapshot = snapshot;
    const nextSnapshot = event.payload;
    if (
      modal.kind === "group" &&
      !modal.saving &&
      prevSnapshot &&
      groupModalVisualSignature(prevSnapshot) === groupModalVisualSignature(nextSnapshot)
    ) {
      snapshot = nextSnapshot;
      syncViewModeFromSnapshot(snapshot);
      if (snapshot.activeAccount || !snapshot.switchingAccount) {
        optimisticSwitching = null;
      }
      return;
    }
    saveScrollPosition();
    snapshot = nextSnapshot;
    syncViewModeFromSnapshot(snapshot);
    if (snapshot.activeAccount || !snapshot.switchingAccount) {
      optimisticSwitching = null;
    }
    render();
    restoreScrollPosition();
  });

  await listen<DownloadNoticeEvent>("download-event", (event) => {
    downloadToast = event.payload;
    clearDownloadToastTimer();
    rerenderPreservingScroll();
    scheduleDownloadToastDismiss();
  });

  await listen<UpdateProgressEvent>("update-progress", (event) => {
    const evt = event.payload;
    updateState.progress = evt;
    if (evt.stage === "error") {
      updateState.error = evt.message;
    }
    if (modal.kind !== "update") {
      return;
    }
    const barEl = document.querySelector<HTMLElement>("#update-progress-bar");
    const textEl = document.querySelector<HTMLElement>("#update-progress-text");
    const pctEl = document.querySelector<HTMLElement>("#update-progress-pct");
    if (barEl && textEl && pctEl && lastRenderedUpdateStage === evt.stage && evt.stage !== "error") {
      textEl.textContent = evt.message;
      pctEl.textContent = formatProgressSummary(evt);
      if (evt.percent === null) {
        barEl.classList.add("indeterminate");
        barEl.style.width = "";
      } else {
        barEl.classList.remove("indeterminate");
        barEl.style.width = `${Math.max(0, Math.min(100, evt.percent))}%`;
      }
      return;
    }
    lastRenderedUpdateStage = evt.stage;
    rerenderPreservingScroll();
  });

  window.addEventListener("keydown", async (ev) => {
    if (modal.kind !== "none") {
      if (
        ev.key === "Escape" &&
        !(modal.kind === "add" && modal.saving) &&
        !(modal.kind === "rename" && modal.saving) &&
        !(modal.kind === "group" && modal.saving) &&
        !(modal.kind === "group-knowledge" && modal.saving) &&
        !(modal.kind === "external-agents" && modal.saving) &&
        !(modal.kind === "settings" && modal.saving) &&
        !(
          modal.kind === "sync" &&
          (modal.lanShareBusy ||
            modal.lanPullBusy ||
            modal.lanScanBusy ||
            modal.fileExportBusy ||
            modal.fileImportBusy)
        ) &&
        !(modal.kind === "update" && updateState.installing)
      ) {
        ev.preventDefault();
        await setModal({ kind: "none" });
      }
      return;
    }
    const target = ev.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey) {
      const digit = parseInt(ev.key, 10);
      if (!isNaN(digit) && digit >= 1 && digit <= 9) {
        ev.preventDefault();
        if (!snapshot) return;
        const providerAccounts = snapshot.accounts.filter(
          (a) => a.providerId === snapshot!.selectedProviderId
        );
        const targetAcc = providerAccounts[digit - 1];
        if (targetAcc && !isSameKey(snapshot.activeAccount, targetAcc)) {
          const alreadyWarm = snapshot.warmAccounts.some(
            (k) =>
              k.providerId === targetAcc.providerId && k.uuid === targetAcc.uuid
          );
          await callCommand(
            "switch_account",
            { providerId: targetAcc.providerId, uuid: targetAcc.uuid },
            alreadyWarm ? null : { providerId: targetAcc.providerId, uuid: targetAcc.uuid }
          );
        }
        return;
      }
      if (
        ev.key === "ArrowUp" ||
        ev.key === "ArrowDown" ||
        ev.key === "[" ||
        ev.key === "]"
      ) {
        ev.preventDefault();
        if (!snapshot) return;
        const providerAccounts = snapshot.accounts.filter(
          (a) => a.providerId === snapshot!.selectedProviderId
        );
        if (providerAccounts.length <= 1) return;
        const curIdx = providerAccounts.findIndex((a) =>
          isSameKey(snapshot!.activeAccount, a)
        );
        const delta = ev.key === "ArrowUp" || ev.key === "[" ? -1 : 1;
        const nextIdx =
          (curIdx + delta + providerAccounts.length) % providerAccounts.length;
        const targetAcc = providerAccounts[nextIdx];
        if (targetAcc && !isSameKey(snapshot.activeAccount, targetAcc)) {
          const alreadyWarm = snapshot.warmAccounts.some(
            (k) =>
              k.providerId === targetAcc.providerId && k.uuid === targetAcc.uuid
          );
          await callCommand(
            "switch_account",
            { providerId: targetAcc.providerId, uuid: targetAcc.uuid },
            alreadyWarm ? null : { providerId: targetAcc.providerId, uuid: targetAcc.uuid }
          );
        }
      }
    }
  });

  snapshot = await invoke<ManagerSnapshot>("get_manager_state");
  syncViewModeFromSnapshot(snapshot);
  render();
  setTimeout(() => {
    void runCheckForUpdates(true);
  }, 3000);
  window.setInterval(() => {
    void maybeAutoCheckForUpdates();
  }, 30 * 60 * 1000);
  window.addEventListener("focus", () => {
    void maybeAutoCheckForUpdates();
  });
  window.addEventListener("online", () => {
    void maybeAutoCheckForUpdates();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void maybeAutoCheckForUpdates();
    }
  });
}

void bootstrap();
