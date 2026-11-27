import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import type {
  AccountKey,
  AccountLease,
  AccountRecord,
  AccountRuleConfig,
  AgentProfile,
  ExportSyncBundleResponse,
  ExternalAgentKind,
  ExternalAgentRecord,
  GroupChatMessage,
  GroupChatRecord,
  GroupMemberRole,
  GroupSharedSkill,
  GroupWorkflowMode,
  ImportSyncBundleResponse,
  InstallUpdateOutcome,
  LanSyncShareInfo,
  ManagerSnapshot,
  OrchestratedTask,
  PipelineStep,
  ProviderInfo,
  ProxyTestResult,
  RouterPolicyConfig,
  RoutingDecisionPreview,
  RoutingStrategy,
  ScanQrResult,
  SiteAdapterConfig,
  SiteAdaptersSnapshot,
  UpdateCheckResult,
  WorkflowPipeline,
} from "./types";
import {
  acquireAccountLease,
  accountKeyStr,
  defaultRouterPolicy,
  normalizeRouterPolicy,
  previewRoutingDecision,
  recoverExpiredLeases,
  releaseAccountLease,
} from "./engine/smart-router";
import {
  AGENT_TEMPLATES,
  createDefaultAgents,
  createDefaultWorkflows,
  recoverInterruptedTasks,
  validateWorkflowPipeline,
} from "./engine/orchestrator";
import {
  buildInitialNodeExecutions,
  runOrchestratedTaskLoop,
} from "./engine/task-runner";

const STORAGE_KEY = "maam_web_bridge_state_v2";
const ADAPTERS_STORAGE_KEY = "maam_web_bridge_adapters_v1";
const OFFICIAL_RELAY_URL = "https://sync.ldjx7.qzz.io";

type EventCallback<T> = (event: { payload: T }) => void;

const listeners = new Map<string, Set<EventCallback<unknown>>>();

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}

function emitEvent<T>(eventName: string, payload: T): void {
  const set = listeners.get(eventName);
  if (!set) return;
  for (const cb of set) {
    try {
      (cb as EventCallback<T>)({ payload });
    } catch {
      // ignore listener errors
    }
  }
}

function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function defaultProviders(): ProviderInfo[] {
  return [
    {
      id: "muse",
      name: "Muse · Meta",
      shortName: "Muse",
      enabled: true,
      statusText: "Enabled",
      entryUrl: "https://muse.ai/",
      homepageUrl: "https://muse.ai/",
      callbackOrigins: ["https://muse.ai", "https://www.muse.ai"],
      verifiedMethods: ["email", "phone"],
    },
    {
      id: "hark",
      name: "Hark",
      shortName: "Hark",
      enabled: true,
      statusText: "Enabled",
      entryUrl: "https://app.hark.com/",
      homepageUrl: "https://hark.com/",
      callbackOrigins: ["https://app.hark.com", "https://hark.com"],
      verifiedMethods: ["email", "phone", "apple"],
    },
  ];
}

function builtinAdapters(): SiteAdapterConfig[] {
  return [
    {
      id: "muse",
      name: "Muse · Meta",
      hostPatterns: ["muse.ai", "*.muse.ai"],
      composerSelectors: ['textarea[placeholder*="Message"]', "textarea"],
      sendButtonSelectors: ['button[aria-label*="Send"]', 'button[title*="Send"]'],
      stopButtonSelectors: ['button[aria-label*="Stop"]', 'button[data-testid*="stop" i]'],
      messageListSelectors: ['[data-testid="message-list"]'],
      assistantMessageSelectors: ['[data-message-author-role="assistant"]', '[data-testid*="assistant" i]'],
      newChatSelectors: [],
      newChatUrl: null,
      threadUrlPatterns: [],
      transientStatusWords: ["Replying", "Thinking", "Generating", "Searching"],
      chatApiPatterns: ["/api/", "/events", "/chat", "/view"],
      preferEnterSubmit: false,
      asyncAgent: true,
    },
    {
      id: "hark",
      name: "Hark",
      hostPatterns: ["app.hark.com", "*.hark.com", "hark.com"],
      composerSelectors: ['textarea[placeholder*="Message"]', "textarea"],
      sendButtonSelectors: ['button[type="submit"]', 'button[aria-label*="Send"]'],
      stopButtonSelectors: ['button[aria-label*="Stop"]', 'button[data-testid*="stop" i]'],
      messageListSelectors: ['[data-testid="message-list"]'],
      assistantMessageSelectors: ['[data-message-author-role="assistant"]', '[data-testid*="assistant" i]'],
      newChatSelectors: [],
      newChatUrl: null,
      threadUrlPatterns: [],
      transientStatusWords: ["Read", "Thinking", "Searching"],
      chatApiPatterns: ["/api/messages/send", "/api/messages/", "/api/chat"],
      preferEnterSubmit: false,
      asyncAgent: true,
    },
    {
      id: "generic",
      name: "Generic Fallback",
      hostPatterns: ["*"],
      composerSelectors: ["textarea", '[contenteditable="true"]', '[role="textbox"]'],
      sendButtonSelectors: ['button[data-testid*="send" i]', 'button[aria-label*="Send" i]', 'button[type="submit"]'],
      stopButtonSelectors: ['button[aria-label*="Stop" i]', '[aria-busy="true"]'],
      messageListSelectors: ['[data-testid="message-list"]', '[data-testid*="chat-messages" i]'],
      assistantMessageSelectors: ['[data-message-author-role="assistant"]', '[data-role="assistant"]'],
      newChatSelectors: ['button[aria-label*="New chat" i]'],
      newChatUrl: null,
      threadUrlPatterns: [],
      transientStatusWords: [],
      chatApiPatterns: [],
      preferEnterSubmit: false,
      asyncAgent: false,
    },
  ];
}

function createInitialSnapshot(): ManagerSnapshot {
  const now = Date.now();
  const museUuid = randomUuid();
  const harkUuid = randomUuid();
  return {
    platform: "macos",
    providers: defaultProviders(),
    accounts: [
      {
        providerId: "muse",
        uuid: museUuid,
        alias: "muse.demo@example.com",
        createdAtMs: now - 86400_000,
        autoAlias: false,
        proxyUrl: null,
        timezone: "Asia/Shanghai",
        avatarUrl: null,
        quotaText: "78% · Normal",
        quotaPercent: 22,
        quotaDetail: {
          planLabel: "5h quota",
          planValue: "78% left",
          planSubtext: "Resets in ~3h",
          planUsedPercent: 22,
          extraLabel: "Weekly quota",
          extraValue: "86% left",
          extraSubtext: "Resets Monday",
          extraUsedPercent: 14,
        },
        authState: "authenticated",
        cookieExpiresAtMs: now + 30 * 86400_000,
        cookieSessionOnly: false,
      },
      {
        providerId: "hark",
        uuid: harkUuid,
        alias: "hark.demo@example.com",
        createdAtMs: now - 43200_000,
        autoAlias: false,
        proxyUrl: null,
        timezone: null,
        avatarUrl: null,
        quotaText: "90% · Normal",
        quotaPercent: 10,
        quotaDetail: {
          planLabel: "Daily quota",
          planValue: "90% left",
          planSubtext: "Resets at 00:00",
          planUsedPercent: 10,
          extraLabel: "Monthly quota",
          extraValue: "94% left",
          extraSubtext: "Resets on the 1st",
          extraUsedPercent: 6,
        },
        authState: "authenticated",
        cookieExpiresAtMs: now + 14 * 86400_000,
        cookieSessionOnly: false,
      },
    ],
    selectedProviderId: "muse",
    activeAccount: { providerId: "muse", uuid: museUuid },
    switchingAccount: null,
    warmAccounts: [{ providerId: "muse", uuid: museUuid }],
    lastCommitted: { providerId: "muse", uuid: museUuid },
    pendingCleanup: [],
    conflicts: [],
    notice: null,
    modalActive: false,
    settings: {
      minimizeToTray: true,
      globalShortcut: "CommandOrControl+Shift+M",
      autoApprove: false,
      isolateSameProxyKeepAlive: true,
      silentSyncIntervalMins: 15,
    },
    globalShortcutActive: true,
    globalShortcutError: null,
    groupChats: [
      {
        id: randomUuid(),
        name: "AI Collaboration Demo",
        members: [
          { providerId: "muse", uuid: museUuid },
          { providerId: "hark", uuid: harkUuid },
        ],
        createdAtMs: now - 3600_000,
        messages: [],
        sharedContext: "",
        sharedSkills: [],
        memberRoles: [],
        workflowMode: "parallel",
        maxRelayHops: 2,
        threadBindings: [],
      },
    ],
    activeGroupId: null,
    externalAgents: [],
    accountErrors: [],
    officialRelayUrl: OFFICIAL_RELAY_URL,
    routerPolicy: defaultRouterPolicy(),
    accountLeases: [],
    agents: createDefaultAgents(now),
    workflows: createDefaultWorkflows(now),
    tasks: [],
    activeTaskId: null,
  };
}

let cachedSnapshot: ManagerSnapshot | null = null;
const cookieStore = new Map<string, string>();
let activeLanShare: { info: LanSyncShareInfo; passphrase: string; bundleJson: string } | null = null;
const groupMessageLeases = new Map<string, string>();

function loadSnapshot(): ManagerSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ManagerSnapshot;
      if (parsed && Array.isArray(parsed.providers) && Array.isArray(parsed.accounts)) {
        const now = Date.now();
        // On fresh app/page load, in-flight browser async runners cannot survive reload;
        // release stale runtime leases cleanly and mark interrupted tasks recoverable.
        const recoveredTasks = recoverInterruptedTasks(
          Array.isArray(parsed.tasks) ? parsed.tasks : [],
          now
        );
        const recoveredGroups = (parsed.groupChats ?? []).map((g) => ({
          ...g,
          messages: (g.messages ?? []).map((m) =>
            m.status === "queued" || m.status === "sending" || m.status === "streaming"
              ? {
                  ...m,
                  status: "error" as const,
                  error: "Interrupted by page reload; click Retry",
                }
              : m
          ),
        }));
        const rawLeases = recoverExpiredLeases(
          Array.isArray(parsed.accountLeases) ? parsed.accountLeases : [],
          now
        ).filter((l) => l.holderType !== "task_node" && l.holderType !== "group_chat");

        cachedSnapshot = persistSnapshot({
          ...parsed,
          providers: defaultProviders(),
          switchingAccount: null,
          officialRelayUrl: OFFICIAL_RELAY_URL,
          groupChats: recoveredGroups,
          routerPolicy: normalizeRouterPolicy(parsed.routerPolicy),
          accountLeases: rawLeases,
          agents: Array.isArray(parsed.agents) && parsed.agents.length > 0 ? parsed.agents : createDefaultAgents(now),
          workflows:
            Array.isArray(parsed.workflows) && parsed.workflows.length > 0
              ? parsed.workflows
              : createDefaultWorkflows(now),
          tasks: recoveredTasks,
          activeTaskId: parsed.activeTaskId ?? recoveredTasks[0]?.id ?? null,
        });
        return cachedSnapshot;
      }
    }
  } catch {
    // ignore storage errors
  }
  cachedSnapshot = createInitialSnapshot();
  persistSnapshot(cachedSnapshot);
  return cachedSnapshot;
}

function persistSnapshot(next: ManagerSnapshot): ManagerSnapshot {
  cachedSnapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

function mutateStateAndBroadcast(
  updater: (prev: ManagerSnapshot) => ManagerSnapshot
): ManagerSnapshot {
  const updated = persistSnapshot(updater(loadSnapshot()));
  emitEvent("manager-state-changed", updated);
  return updated;
}

function loadAdapterOverrides(): string {
  try {
    return localStorage.getItem(ADAPTERS_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function getSiteAdaptersSnapshot(): SiteAdaptersSnapshot {
  const overrideJson = loadAdapterOverrides();
  const base = builtinAdapters();
  let adapters = base;
  let hasOverrides = false;
  if (overrideJson.trim()) {
    try {
      const parsed = JSON.parse(overrideJson) as SiteAdapterConfig[];
      if (Array.isArray(parsed)) {
        hasOverrides = true;
        const map = new Map(base.map((a) => [a.id, a]));
        for (const item of parsed) {
          if (item && typeof item.id === "string") {
            map.set(item.id, item);
          }
        }
        adapters = Array.from(map.values());
      }
    } catch {
      // ignore invalid stored override
    }
  }
  return {
    adapters,
    overridePath: "~/.config/musk/site-adapters.json",
    hasOverrides,
    overrideJson,
  };
}

function sameKey(a: AccountKey | null | undefined, b: AccountKey | null | undefined): boolean {
  return Boolean(a && b && a.providerId === b.providerId && a.uuid === b.uuid);
}

function extractEmailFromCookies(raw: string): string | null {
  const match = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(raw);
  return match ? match[0] : null;
}

function accountKeyId(providerId: string, uuid: string): string {
  return `${providerId}:${uuid}`;
}

function buildQrSvgPlaceholder(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  const size = 21;
  const cells: string[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inFinder =
        (x < 7 && y < 7) ||
        (x >= size - 7 && y < 7) ||
        (x < 7 && y >= size - 7);
      let dark = false;
      if (inFinder) {
        const lx = x >= size - 7 ? x - (size - 7) : x;
        const ly = y >= size - 7 ? y - (size - 7) : y;
        dark =
          lx === 0 ||
          lx === 6 ||
          ly === 0 ||
          ly === 6 ||
          (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4);
      } else {
        dark = ((hash ^ (x * 73 + y * 137)) & 3) === 0;
      }
      if (dark) {
        cells.push(`<rect x="${x + 2}" y="${y + 2}" width="1" height="1" fill="#111827"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 4} ${size + 4}" width="160" height="160"><rect width="100%" height="100%" fill="#ffffff"/>${cells.join("")}</svg>`;
}

function resolveMemberAlias(state: ManagerSnapshot, key: AccountKey): string {
  if (key.providerId === "api" || key.providerId === "cli") {
    return state.externalAgents.find((e) => e.id === key.uuid)?.name ?? key.uuid.slice(0, 6);
  }
  return (
    state.accounts.find((a) => a.providerId === key.providerId && a.uuid === key.uuid)?.alias ??
    key.uuid.slice(0, 6)
  );
}

async function generateAgentReply(
  state: ManagerSnapshot,
  group: GroupChatRecord,
  member: AccountKey,
  userPrompt: string,
  stageLabel: string | null
): Promise<string> {
  const roleEntry = group.memberRoles.find((r) => sameKey(r.member, member));
  const roleHint = roleEntry?.role ? ` (Role: ${roleEntry.role})` : "";

  if (member.providerId === "api") {
    const ext = state.externalAgents.find((e) => e.id === member.uuid);
    if (ext && ext.baseUrl && ext.model) {
      try {
        const endpoint = `${ext.baseUrl.replace(/\/+$/, "")}/chat/completions`;
        const sysParts: string[] = [];
        if (roleEntry?.role) sysParts.push(`Assigned role: ${roleEntry.role}`);
        if (group.sharedContext.trim()) sysParts.push(`Shared context:\n${group.sharedContext.trim()}`);
        const enabledSkills = group.sharedSkills.filter((s) => s.enabled);
        if (enabledSkills.length > 0) {
          sysParts.push(
            enabledSkills.map((s) => `[Skill: ${s.name}] ${s.content}`).join("\n")
          );
        }
        const messages: Array<{ role: string; content: string }> = [];
        if (sysParts.length > 0) {
          messages.push({ role: "system", content: sysParts.join("\n\n") });
        }
        messages.push({ role: "user", content: userPrompt });
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (ext.apiKey) headers["Authorization"] = `Bearer ${ext.apiKey}`;
        const resp = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: ext.model, messages }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = data?.choices?.[0]?.message?.content?.trim();
          if (content) return content;
        }
      } catch {
        // Fallback to simulated preview response when external endpoint is unreachable/CORS-blocked
      }
    }
  }

  const alias = resolveMemberAlias(state, member);
  const ctxSummary = group.sharedContext.trim()
    ? `\n\nReferenced shared context (${group.sharedContext.trim().slice(0, 60)}${group.sharedContext.trim().length > 60 ? "..." : ""}).`
    : "";
  const stagePrefix = stageLabel ? `[${stageLabel}] ` : "";
  return `${stagePrefix}Hello from ${alias}${roleHint}. Received your message in Web preview mode: "${userPrompt.slice(0, 120)}${userPrompt.length > 120 ? "..." : ""}".\n\nNote: Native isolated WebView sessions and local CLI execution require the desktop Tauri runtime; you can still test group orchestration, member roles, shared skills, backup import/export, and account switching here.${ctxSummary}`;
}

function scheduleGroupReplies(groupId: string, msgIds: string[], prompt: string): void {
  msgIds.forEach((msgId, idx) => {
    setTimeout(async () => {
      const leaseId = groupMessageLeases.get(msgId);
      try {
        const current = loadSnapshot();
        const group = current.groupChats.find((g) => g.id === groupId);
        if (!group) return;
        const msg = group.messages.find((m) => m.id === msgId);
        if (!msg || !msg.sender) return;

        const updatedSending: ManagerSnapshot = {
          ...current,
          groupChats: current.groupChats.map((g) =>
            g.id === groupId
              ? {
                  ...g,
                  messages: g.messages.map((m) =>
                    m.id === msgId ? { ...m, status: "streaming" } : m
                  ),
                }
              : g
          ),
        };
        persistSnapshot(updatedSending);
        emitEvent("manager-state-changed", updatedSending);

        const replyText = await generateAgentReply(
          updatedSending,
          group,
          msg.sender,
          prompt,
          msg.stageLabel ?? null
        );

        const latest = loadSnapshot();
        const doneState: ManagerSnapshot = {
          ...latest,
          accountLeases: leaseId
            ? releaseAccountLease(latest.accountLeases ?? [], leaseId)
            : latest.accountLeases,
          groupChats: latest.groupChats.map((g) =>
            g.id === groupId
              ? {
                  ...g,
                  messages: g.messages.map((m) =>
                    m.id === msgId
                      ? { ...m, status: "done", content: replyText, error: null }
                      : m
                  ),
                }
              : g
          ),
        };
        persistSnapshot(doneState);
        emitEvent("manager-state-changed", doneState);
      } finally {
        if (leaseId) {
          groupMessageLeases.delete(msgId);
          const cur = loadSnapshot();
          if ((cur.accountLeases ?? []).some((l) => l.id === leaseId)) {
            mutateStateAndBroadcast((prev) => ({
              ...prev,
              accountLeases: releaseAccountLease(prev.accountLeases ?? [], leaseId),
            }));
          }
        }
      }
    }, 350 + idx * 450);
  });
}

async function webInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const state = loadSnapshot();

  switch (cmd) {
    case "get_manager_state":
      return state as unknown as T;

    case "select_provider": {
      const providerId = String(args.providerId ?? "muse");
      const firstAcc = state.accounts.find((a) => a.providerId === providerId) ?? null;
      const next = persistSnapshot({
        ...state,
        selectedProviderId: providerId,
        activeGroupId: null,
        activeAccount: firstAcc ? { providerId: firstAcc.providerId, uuid: firstAcc.uuid } : null,
      });
      return next as unknown as T;
    }

    case "add_account": {
      const providerId = String(args.providerId ?? state.selectedProviderId);
      const rawAlias = String(args.alias ?? "").trim();
      const proxyUrl = args.proxyUrl ? String(args.proxyUrl).trim() || null : null;
      const timezone = args.timezone ? String(args.timezone).trim() || null : null;
      const rawCookies = args.rawCookies ? String(args.rawCookies).trim() : "";

      const uuid = randomUuid();
      const extracted = rawCookies ? extractEmailFromCookies(rawCookies) : null;
      const hasCookies = rawCookies.length > 0;
      const alias = rawAlias || extracted || (hasCookies ? "Signed-in Account" : `${providerId.toUpperCase()} Account`);
      if (hasCookies) {
        cookieStore.set(accountKeyId(providerId, uuid), rawCookies);
      }

      const now = Date.now();
      const newAcc: AccountRecord = {
        providerId,
        uuid,
        alias,
        createdAtMs: now,
        autoAlias: !rawAlias && !extracted,
        proxyUrl,
        timezone,
        avatarUrl: null,
        quotaText: hasCookies ? "100% · Normal" : null,
        quotaPercent: hasCookies ? 0 : null,
        quotaDetail: hasCookies
          ? {
              planLabel: "Base quota",
              planValue: "100% left",
              planSubtext: "Web preview session",
              planUsedPercent: 0,
              extraLabel: null,
              extraValue: null,
              extraSubtext: null,
              extraUsedPercent: null,
            }
          : null,
        authState: hasCookies ? "authenticated" : "logged_out",
        cookieExpiresAtMs: hasCookies ? now + 30 * 86400_000 : null,
        cookieSessionOnly: false,
      };
      const key: AccountKey = { providerId, uuid };
      const next = persistSnapshot({
        ...state,
        selectedProviderId: providerId,
        activeGroupId: null,
        accounts: [...state.accounts, newAcc],
        activeAccount: key,
        warmAccounts: [...state.warmAccounts, key],
        lastCommitted: key,
      });
      return next as unknown as T;
    }

    case "rename_account": {
      const providerId = String(args.providerId ?? "");
      const uuid = String(args.uuid ?? "");
      const rawAlias = String(args.alias ?? "").trim();
      const proxyUrl = args.proxyUrl !== undefined ? (String(args.proxyUrl || "").trim() || null) : undefined;
      const timezone = args.timezone !== undefined ? (String(args.timezone || "").trim() || null) : undefined;

      const next = persistSnapshot({
        ...state,
        accounts: state.accounts.map((a) =>
          a.providerId === providerId && a.uuid === uuid
            ? {
                ...a,
                alias: rawAlias || a.alias,
                autoAlias: rawAlias ? false : a.autoAlias,
                proxyUrl: proxyUrl !== undefined ? proxyUrl : a.proxyUrl,
                timezone: timezone !== undefined ? timezone : a.timezone,
              }
            : a
        ),
      });
      return next as unknown as T;
    }

    case "import_account_cookies": {
      const providerId = String(args.providerId ?? "");
      const uuid = String(args.uuid ?? "");
      const rawCookies = String(args.rawCookies ?? "").trim();
      if (!rawCookies) {
        throw new Error("Cookie content cannot be empty");
      }
      cookieStore.set(accountKeyId(providerId, uuid), rawCookies);
      const extracted = extractEmailFromCookies(rawCookies);
      const now = Date.now();
      const next = persistSnapshot({
        ...state,
        accounts: state.accounts.map((a) =>
          a.providerId === providerId && a.uuid === uuid
            ? {
                ...a,
                alias: a.autoAlias && extracted ? extracted : a.alias,
                autoAlias: a.autoAlias && extracted ? false : a.autoAlias,
                authState: "authenticated",
                cookieExpiresAtMs: now + 30 * 86400_000,
                quotaText: a.quotaText ?? "100% · Normal",
                quotaPercent: a.quotaPercent ?? 0,
              }
            : a
        ),
        notice: "Cookies imported and login status updated",
      });
      return next as unknown as T;
    }

    case "copy_account_cookie": {
      const providerId = String(args.providerId ?? "");
      const uuid = String(args.uuid ?? "");
      const acc = state.accounts.find((a) => a.providerId === providerId && a.uuid === uuid);
      if (!acc || acc.authState !== "authenticated") {
        throw new Error("This account is not signed in; no cookies available to copy");
      }
      const value =
        cookieStore.get(accountKeyId(providerId, uuid)) ||
        `session_id=web_preview_${uuid.slice(0, 8)}; provider=${providerId}`;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
      return undefined as unknown as T;
    }

    case "remove_account": {
      const providerId = String(args.providerId ?? "");
      const uuid = String(args.uuid ?? "");
      const key = { providerId, uuid };
      const accounts = state.accounts.filter((a) => !(a.providerId === providerId && a.uuid === uuid));
      const warmAccounts = state.warmAccounts.filter((k) => !sameKey(k, key));
      const activeAccount = sameKey(state.activeAccount, key)
        ? accounts.find((a) => a.providerId === state.selectedProviderId)
          ? {
              providerId: state.selectedProviderId,
              uuid: accounts.find((a) => a.providerId === state.selectedProviderId)!.uuid,
            }
          : null
        : state.activeAccount;
      const groupChats = state.groupChats.map((g) => ({
        ...g,
        members: g.members.filter((m) => !sameKey(m, key)),
        memberRoles: g.memberRoles.filter((r) => !sameKey(r.member, key)),
      }));
      const next = persistSnapshot({
        ...state,
        accounts,
        warmAccounts,
        activeAccount,
        groupChats,
      });
      return next as unknown as T;
    }

    case "reorder_accounts": {
      const providerId = String(args.providerId ?? "");
      const orderedUuids = Array.isArray(args.orderedUuids) ? args.orderedUuids.map(String) : [];
      const others = state.accounts.filter((a) => a.providerId !== providerId);
      const targetMap = new Map(
        state.accounts.filter((a) => a.providerId === providerId).map((a) => [a.uuid, a])
      );
      const reordered: AccountRecord[] = [];
      for (const u of orderedUuids) {
        const hit = targetMap.get(u);
        if (hit) {
          reordered.push(hit);
          targetMap.delete(u);
        }
      }
      for (const rest of targetMap.values()) {
        reordered.push(rest);
      }
      const next = persistSnapshot({
        ...state,
        accounts: [...others, ...reordered],
      });
      return next as unknown as T;
    }

    case "switch_account": {
      const providerId = String(args.providerId ?? "");
      const uuid = String(args.uuid ?? "");
      const key: AccountKey = { providerId, uuid };
      const warmAccounts = state.warmAccounts.some((k) => sameKey(k, key))
        ? state.warmAccounts
        : [...state.warmAccounts, key];
      const next = persistSnapshot({
        ...state,
        selectedProviderId: providerId,
        activeGroupId: null,
        activeAccount: key,
        warmAccounts,
        lastCommitted: key,
      });
      return next as unknown as T;
    }

    case "reload_account": {
      const providerId = String(args.providerId ?? "");
      const uuid = String(args.uuid ?? "");
      const next = persistSnapshot({
        ...state,
        accounts: state.accounts.map((a) =>
          a.providerId === providerId && a.uuid === uuid
            ? {
                ...a,
                authState: a.authState === "unknown" ? "authenticated" : a.authState,
              }
            : a
        ),
        notice: "Account status refreshed",
      });
      return next as unknown as T;
    }

    case "clear_account_data": {
      const providerId = String(args.providerId ?? "");
      const uuid = String(args.uuid ?? "");
      cookieStore.delete(accountKeyId(providerId, uuid));
      const key = { providerId, uuid };
      const next = persistSnapshot({
        ...state,
        accounts: state.accounts.map((a) =>
          a.providerId === providerId && a.uuid === uuid
            ? {
                ...a,
                authState: "logged_out",
                quotaText: null,
                quotaPercent: null,
                quotaDetail: null,
                cookieExpiresAtMs: null,
              }
            : a
        ),
        warmAccounts: state.warmAccounts.filter((k) => !sameKey(k, key)),
        notice: "Account login cache cleared",
      });
      return next as unknown as T;
    }

    case "test_account_proxy": {
      const raw = String(args.proxyUrl ?? "").trim();
      if (!raw) {
        return {
          ok: true,
          latencyMs: 24,
          statusCode: 200,
          targetHost: "direct",
          usedProxy: false,
          message: "Direct system network check passed (Web preview simulation)",
        } satisfies ProxyTestResult as unknown as T;
      }
      try {
        const parsed = new URL(raw);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return {
            ok: false,
            latencyMs: 0,
            statusCode: null,
            targetHost: raw,
            usedProxy: true,
            message: "Only http:// or https:// proxy URLs are supported",
          } satisfies ProxyTestResult as unknown as T;
        }
        return {
          ok: true,
          latencyMs: 68,
          statusCode: 200,
          targetHost: parsed.host,
          usedProxy: true,
          message: `Proxy URL valid (${parsed.host}); native proxy tunneling applies on desktop/iOS`,
        } satisfies ProxyTestResult as unknown as T;
      } catch {
        return {
          ok: false,
          latencyMs: 0,
          statusCode: null,
          targetHost: raw,
          usedProxy: true,
          message: "Invalid proxy URL format. Use http://host:port",
        } satisfies ProxyTestResult as unknown as T;
      }
    }

    case "set_modal_active": {
      const active = Boolean(args.active);
      const next = persistSnapshot({ ...state, modalActive: active });
      return next as unknown as T;
    }

    case "open_official_site": {
      const providerId = String(args.providerId ?? state.selectedProviderId);
      const provider = state.providers.find((p) => p.id === providerId);
      const next = persistSnapshot({
        ...state,
        notice: provider ? `Official website: ${provider.homepageUrl}` : null,
      });
      return next as unknown as T;
    }

    case "open_external_url": {
      const url = String(args.url ?? "");
      if (url) {
        persistSnapshot({ ...state, notice: `External link: ${url}` });
        emitEvent("manager-state-changed", loadSnapshot());
      }
      return undefined as unknown as T;
    }

    case "resolve_uuid_conflict": {
      const uuid = String(args.uuid ?? "");
      const next = persistSnapshot({
        ...state,
        conflicts: state.conflicts.filter((c) => c.uuid !== uuid),
      });
      return next as unknown as T;
    }

    case "dismiss_notice": {
      const next = persistSnapshot({ ...state, notice: null });
      return next as unknown as T;
    }

    case "trigger_quota_sync": {
      const next = persistSnapshot({
        ...state,
        notice: "Synced quotas for all online accounts",
      });
      return next as unknown as T;
    }

    case "update_app_settings": {
      const next = persistSnapshot({
        ...state,
        settings: {
          minimizeToTray: Boolean(args.minimizeToTray),
          globalShortcut: String(args.globalShortcut ?? ""),
          autoApprove: Boolean(args.autoApprove),
          isolateSameProxyKeepAlive:
            args.isolateSameProxyKeepAlive !== undefined
              ? Boolean(args.isolateSameProxyKeepAlive)
              : state.settings.isolateSameProxyKeepAlive,
          silentSyncIntervalMins:
            typeof args.silentSyncIntervalMins === "number"
              ? args.silentSyncIntervalMins
              : state.settings.silentSyncIntervalMins,
        },
        globalShortcutActive: Boolean(String(args.globalShortcut ?? "").trim()),
      });
      return next as unknown as T;
    }

    case "select_group_chat": {
      const groupId = args.groupId ? String(args.groupId) : null;
      const next = persistSnapshot({
        ...state,
        activeGroupId: groupId,
      });
      return next as unknown as T;
    }

    case "create_group_chat": {
      const name = String(args.name ?? "").trim();
      const members = Array.isArray(args.members) ? (args.members as AccountKey[]) : [];
      if (!name) throw new Error("Please enter a group chat name");
      if (members.length === 0) throw new Error("Please select at least one member");
      const newGroup: GroupChatRecord = {
        id: randomUuid(),
        name,
        members,
        createdAtMs: Date.now(),
        messages: [],
        sharedContext: "",
        sharedSkills: [],
        memberRoles: [],
        workflowMode: "parallel",
        maxRelayHops: 2,
        threadBindings: [],
      };
      const next = persistSnapshot({
        ...state,
        groupChats: [...state.groupChats, newGroup],
        activeGroupId: newGroup.id,
      });
      return next as unknown as T;
    }

    case "update_group_chat": {
      const groupId = String(args.groupId ?? "");
      const name = String(args.name ?? "").trim();
      const members = Array.isArray(args.members) ? (args.members as AccountKey[]) : [];
      if (!name) throw new Error("Please enter a group chat name");
      if (members.length === 0) throw new Error("Please select at least one member");
      const next = persistSnapshot({
        ...state,
        groupChats: state.groupChats.map((g) =>
          g.id === groupId ? { ...g, name, members } : g
        ),
      });
      return next as unknown as T;
    }

    case "delete_group_chat": {
      const groupId = String(args.groupId ?? "");
      const remaining = state.groupChats.filter((g) => g.id !== groupId);
      const next = persistSnapshot({
        ...state,
        groupChats: remaining,
        activeGroupId: state.activeGroupId === groupId ? remaining[0]?.id ?? null : state.activeGroupId,
      });
      return next as unknown as T;
    }

    case "send_group_message": {
      const groupId = String(args.groupId ?? "");
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("Message content cannot be empty");
      const group = state.groupChats.find((g) => g.id === groupId);
      if (!group) throw new Error("Group chat not found");

      const explicitTargets = Array.isArray(args.targetMembers)
        ? (args.targetMembers as AccountKey[])
        : null;
      const autoChannels = Array.isArray(args.autoChannels)
        ? args.autoChannels.map(String)
        : [];

      let workingPolicy = normalizeRouterPolicy(state.routerPolicy);
      let workingLeases = recoverExpiredLeases(state.accountLeases ?? []);
      const resolvedTargets: Array<{ member: AccountKey; leaseId: string | null; autoRoutedChannel: string | null }> = [];

      if (explicitTargets && explicitTargets.length > 0) {
        for (const member of explicitTargets) {
          let leaseId: string | null = null;
          if (member.providerId !== "api" && member.providerId !== "cli") {
            const lid = `lease_${randomUuid().slice(0, 8)}`;
            const res = acquireAccountLease({
              accounts: state.accounts,
              policy: workingPolicy,
              leases: workingLeases,
              providerId: member.providerId,
              pinnedAccount: member,
              accountErrors: state.accountErrors,
              holderType: "group_chat",
              holderId: groupId,
              holderLabel: `Group: ${group.name}`,
              leaseId: lid,
            });
            if (res.ok && res.lease) {
              workingLeases = res.nextLeases;
              workingPolicy = res.nextPolicy;
              leaseId = res.lease.id;
            }
          }
          resolvedTargets.push({ member, leaseId, autoRoutedChannel: null });
        }
      } else if (autoChannels.length > 0) {
        for (const ch of autoChannels) {
          const channelMembers = group.members.filter((m) => m.providerId === ch);
          if (channelMembers.length === 0) continue;
          if (ch === "api" || ch === "cli") {
            resolvedTargets.push({ member: channelMembers[0], leaseId: null, autoRoutedChannel: ch });
            continue;
          }
          const lid = `lease_${randomUuid().slice(0, 8)}`;
          const res = acquireAccountLease({
            accounts: state.accounts,
            policy: workingPolicy,
            leases: workingLeases,
            providerId: ch,
            accountPool: channelMembers,
            accountErrors: state.accountErrors,
            holderType: "group_chat",
            holderId: groupId,
            holderLabel: `Group (${ch}): ${group.name}`,
            leaseId: lid,
          });
          if (res.ok && res.lease) {
            workingLeases = res.nextLeases;
            workingPolicy = res.nextPolicy;
            resolvedTargets.push({ member: res.lease.account, leaseId: res.lease.id, autoRoutedChannel: ch });
          } else {
            resolvedTargets.push({ member: channelMembers[0], leaseId: null, autoRoutedChannel: ch });
          }
        }
      } else {
        const eligibleMembers = group.members.filter((m) => {
          if (m.providerId === "api" || m.providerId === "cli") return true;
          const acc = state.accounts.find(
            (a) => a.providerId === m.providerId && a.uuid === m.uuid
          );
          return acc?.authState === "authenticated";
        });
        const list = eligibleMembers.length > 0 ? eligibleMembers : group.members.slice(0, 1);
        for (const member of list) {
          let leaseId: string | null = null;
          if (member.providerId !== "api" && member.providerId !== "cli") {
            const lid = `lease_${randomUuid().slice(0, 8)}`;
            const res = acquireAccountLease({
              accounts: state.accounts,
              policy: workingPolicy,
              leases: workingLeases,
              providerId: member.providerId,
              pinnedAccount: member,
              accountErrors: state.accountErrors,
              holderType: "group_chat",
              holderId: groupId,
              holderLabel: `Group: ${group.name}`,
              leaseId: lid,
            });
            if (res.ok && res.lease) {
              workingLeases = res.nextLeases;
              workingPolicy = res.nextPolicy;
              leaseId = res.lease.id;
            }
          }
          resolvedTargets.push({ member, leaseId, autoRoutedChannel: null });
        }
      }

      if (resolvedTargets.length === 0 && group.members.length > 0) {
        resolvedTargets.push({ member: group.members[0], leaseId: null, autoRoutedChannel: null });
      }

      const targets = resolvedTargets.map((t) => t.member);
      const now = Date.now();
      const userMsg: GroupChatMessage = {
        id: randomUuid(),
        role: "user",
        sender: null,
        senderName: "Me",
        content,
        createdAtMs: now,
        status: "done",
        targets,
        error: null,
      };

      const mode = group.workflowMode ?? "parallel";
      const assistantMsgs: GroupChatMessage[] = resolvedTargets.map((item, idx) => {
        const msgId = randomUuid();
        if (item.leaseId) {
          groupMessageLeases.set(msgId, item.leaseId);
        }
        return {
          id: msgId,
          role: "assistant",
          sender: item.member,
          senderName: resolveMemberAlias(state, item.member),
          content: "",
          createdAtMs: now + idx + 1,
          status: "queued",
          targets: [],
          error: null,
          autoRoutedChannel: item.autoRoutedChannel,
          stageLabel:
            mode === "review"
              ? idx === 0
                ? "Draft"
                : idx === resolvedTargets.length - 1
                  ? "Final"
                  : "Review"
              : null,
        };
      });

      const next = persistSnapshot({
        ...state,
        routerPolicy: workingPolicy,
        accountLeases: workingLeases,
        groupChats: state.groupChats.map((g) =>
          g.id === groupId
            ? { ...g, messages: [...g.messages, userMsg, ...assistantMsgs] }
            : g
        ),
      });

      scheduleGroupReplies(
        groupId,
        assistantMsgs.map((m) => m.id),
        content
      );
      return next as unknown as T;
    }

    case "retry_group_message": {
      const groupId = String(args.groupId ?? "");
      const msgId = String(args.msgId ?? "");
      const group = state.groupChats.find((g) => g.id === groupId);
      const lastUser = [...(group?.messages ?? [])].reverse().find((m) => m.role === "user");
      const next = persistSnapshot({
        ...state,
        groupChats: state.groupChats.map((g) =>
          g.id === groupId
            ? {
                ...g,
                messages: g.messages.map((m) =>
                  m.id === msgId ? { ...m, status: "queued", error: null } : m
                ),
              }
            : g
        ),
      });
      scheduleGroupReplies(groupId, [msgId], lastUser?.content ?? "Please retry your reply");
      return next as unknown as T;
    }

    case "sync_group_message_reply": {
      const groupId = String(args.groupId ?? "");
      const msgId = String(args.msgId ?? "");
      const next = persistSnapshot({
        ...state,
        groupChats: state.groupChats.map((g) =>
          g.id === groupId
            ? {
                ...g,
                messages: g.messages.map((m) =>
                  m.id === msgId
                    ? { ...m, status: "done", content: m.content || "Synced latest reply." }
                    : m
                ),
              }
            : g
        ),
      });
      return next as unknown as T;
    }

    case "clear_group_messages": {
      const groupId = String(args.groupId ?? "");
      const next = persistSnapshot({
        ...state,
        groupChats: state.groupChats.map((g) =>
          g.id === groupId ? { ...g, messages: [] } : g
        ),
      });
      return next as unknown as T;
    }

    case "start_group_new_topic": {
      const groupId = String(args.groupId ?? "");
      const keepSharedContext = Boolean(args.keepSharedContext);
      const next = persistSnapshot({
        ...state,
        groupChats: state.groupChats.map((g) =>
          g.id === groupId
            ? {
                ...g,
                messages: [],
                threadBindings: [],
                sharedContext: keepSharedContext ? g.sharedContext : "",
              }
            : g
        ),
      });
      return next as unknown as T;
    }

    case "update_group_knowledge": {
      const groupId = String(args.groupId ?? "");
      const sharedContext = String(args.sharedContext ?? "");
      const sharedSkills = Array.isArray(args.sharedSkills)
        ? (args.sharedSkills as GroupSharedSkill[])
        : [];
      const memberRoles = Array.isArray(args.memberRoles)
        ? (args.memberRoles as GroupMemberRole[])
        : [];
      const next = persistSnapshot({
        ...state,
        groupChats: state.groupChats.map((g) =>
          g.id === groupId
            ? { ...g, sharedContext, sharedSkills, memberRoles }
            : g
        ),
      });
      return next as unknown as T;
    }

    case "append_group_shared_context": {
      const groupId = String(args.groupId ?? "");
      const snippet = String(args.snippet ?? "").trim();
      const next = persistSnapshot({
        ...state,
        groupChats: state.groupChats.map((g) => {
          if (g.id !== groupId || !snippet) return g;
          const combined = g.sharedContext.trim()
            ? `${g.sharedContext.trim()}\n\n${snippet}`
            : snippet;
          return { ...g, sharedContext: combined.slice(0, 8000) };
        }),
      });
      return next as unknown as T;
    }

    case "upsert_external_agent": {
      const id = args.id ? String(args.id) : null;
      const kind = (args.kind === "local_cli" ? "local_cli" : "openai_api") as ExternalAgentKind;
      const name = String(args.name ?? "").trim();
      const baseUrl = String(args.baseUrl ?? "").trim();
      const apiKey = String(args.apiKey ?? "").trim();
      const model = String(args.model ?? "").trim();
      const command = String(args.command ?? "").trim();
      const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
      const workdir = args.workdir ? String(args.workdir).trim() || null : null;

      if (!name) throw new Error("Please enter a display name");
      if (kind === "openai_api" && (!baseUrl || !model)) {
        throw new Error("OpenAI API members require both Base URL and Model name");
      }
      if (kind === "local_cli" && !command) {
        throw new Error("Local CLI members require a CLI command");
      }

      const record: ExternalAgentRecord = {
        id: id || randomUuid(),
        kind,
        name,
        baseUrl,
        apiKey,
        model,
        command,
        args: cmdArgs,
        workdir,
        createdAtMs: Date.now(),
      };
      const exists = state.externalAgents.some((e) => e.id === record.id);
      const externalAgents = exists
        ? state.externalAgents.map((e) => (e.id === record.id ? record : e))
        : [...state.externalAgents, record];
      const next = persistSnapshot({ ...state, externalAgents });
      return next as unknown as T;
    }

    case "delete_external_agent": {
      const id = String(args.id ?? "");
      const externalAgents = state.externalAgents.filter((e) => e.id !== id);
      const groupChats = state.groupChats.map((g) => ({
        ...g,
        members: g.members.filter(
          (m) => !((m.providerId === "api" || m.providerId === "cli") && m.uuid === id)
        ),
      }));
      const next = persistSnapshot({ ...state, externalAgents, groupChats });
      return next as unknown as T;
    }

    case "update_group_workflow": {
      const groupId = String(args.groupId ?? "");
      const workflowMode = (args.workflowMode ?? "parallel") as GroupWorkflowMode;
      const maxRelayHops = typeof args.maxRelayHops === "number" ? args.maxRelayHops : 2;
      const next = persistSnapshot({
        ...state,
        groupChats: state.groupChats.map((g) =>
          g.id === groupId ? { ...g, workflowMode, maxRelayHops } : g
        ),
      });
      return next as unknown as T;
    }

    case "reset_group_thread_binding": {
      const groupId = String(args.groupId ?? "");
      const member = args.member as AccountKey | undefined;
      const next = persistSnapshot({
        ...state,
        groupChats: state.groupChats.map((g) =>
          g.id === groupId && member
            ? {
                ...g,
                threadBindings: (g.threadBindings ?? []).filter(
                  (b) => !sameKey(b.member, member)
                ),
              }
            : g
        ),
      });
      return next as unknown as T;
    }

    case "get_site_adapters":
      return getSiteAdaptersSnapshot() as unknown as T;

    case "save_site_adapter_overrides": {
      const rawJson = String(args.rawJson ?? "").trim();
      if (rawJson) {
        const parsed = JSON.parse(rawJson);
        if (!Array.isArray(parsed)) {
          throw new Error("Override rules must be a JSON array");
        }
      }
      try {
        if (rawJson) localStorage.setItem(ADAPTERS_STORAGE_KEY, rawJson);
        else localStorage.removeItem(ADAPTERS_STORAGE_KEY);
      } catch {
        // ignore
      }
      return getSiteAdaptersSnapshot() as unknown as T;
    }

    case "reset_site_adapter_overrides": {
      try {
        localStorage.removeItem(ADAPTERS_STORAGE_KEY);
      } catch {
        // ignore
      }
      return getSiteAdaptersSnapshot() as unknown as T;
    }

    case "check_for_updates": {
      return {
        currentVersion: "0.2.0",
        latestVersion: "0.2.0",
        hasUpdate: false,
        releaseNotes: "Running in Web preview mode. You are on the latest version.",
        pubDate: null,
        downloadUrl: null,
        sha256: null,
        filename: null,
        size: null,
        releasePageUrl: "https://github.com/ldjx7/multi-agent-account-manager/releases",
      } satisfies UpdateCheckResult as unknown as T;
    }

    case "download_and_install_update": {
      return {
        status: "up_to_date",
        message: "Browser preview does not require automatic installer updates. Visit the release page for desktop or mobile packages.",
      } satisfies InstallUpdateOutcome as unknown as T;
    }

    case "export_sync_bundle": {
      const passphrase = String(args.passphrase ?? "");
      if (!passphrase.trim()) {
        throw new Error("Please set an encryption passphrase");
      }
      const payload = {
        format: "maam-web-bundle-v1",
        passphraseHash: btoa(unescape(encodeURIComponent(passphrase))),
        exportedAtMs: Date.now(),
        accounts: state.accounts,
        groupChats: state.groupChats,
        externalAgents: state.externalAgents,
        agents: state.agents ?? [],
        workflows: state.workflows ?? [],
        routerPolicy: state.routerPolicy ?? defaultRouterPolicy(),
      };
      const bundleJson = JSON.stringify(payload, null, 2);
      return {
        filename: `musk-backup-${new Date().toISOString().slice(0, 10)}.maam`,
        savedPath: null,
        downloadId: null,
        bundleJson,
        accountCount: state.accounts.length,
        cookieAccountCount: state.accounts.filter((a) => a.authState === "authenticated").length,
      } satisfies ExportSyncBundleResponse as unknown as T;
    }

    case "import_sync_bundle": {
      const bundleJson = String(args.bundleJson ?? "").trim();
      const passphrase = String(args.passphrase ?? "");
      if (!bundleJson) throw new Error("Please paste or choose a .maam backup file");
      const parsed = JSON.parse(bundleJson) as {
        format?: string;
        passphraseHash?: string;
        accounts?: AccountRecord[];
        groupChats?: GroupChatRecord[];
        externalAgents?: ExternalAgentRecord[];
        agents?: AgentProfile[];
        workflows?: WorkflowPipeline[];
        routerPolicy?: RouterPolicyConfig;
      };
      if (parsed.passphraseHash) {
        const expected = btoa(unescape(encodeURIComponent(passphrase)));
        if (parsed.passphraseHash !== expected) {
          throw new Error("Incorrect decryption passphrase");
        }
      }
      const incomingAccounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
      const incomingGroups = Array.isArray(parsed.groupChats) ? parsed.groupChats : [];
      const incomingExts = Array.isArray(parsed.externalAgents) ? parsed.externalAgents : [];
      const incomingAgents = Array.isArray(parsed.agents) ? parsed.agents : [];
      const incomingWorkflows = Array.isArray(parsed.workflows) ? parsed.workflows : [];

      let addedAccounts = 0;
      let updatedAccounts = 0;
      const mergedAccounts = [...state.accounts];
      for (const acc of incomingAccounts) {
        const idx = mergedAccounts.findIndex(
          (x) => x.providerId === acc.providerId && x.uuid === acc.uuid
        );
        if (idx >= 0) {
          mergedAccounts[idx] = { ...mergedAccounts[idx], ...acc };
          updatedAccounts += 1;
        } else {
          mergedAccounts.push(acc);
          addedAccounts += 1;
        }
      }
      const mergedGroups = [...state.groupChats];
      let mergedGroupCount = 0;
      for (const g of incomingGroups) {
        if (!mergedGroups.some((x) => x.id === g.id)) {
          mergedGroups.push(g);
          mergedGroupCount += 1;
        }
      }
      const mergedExts = [...state.externalAgents];
      let mergedExtCount = 0;
      for (const e of incomingExts) {
        if (!mergedExts.some((x) => x.id === e.id)) {
          mergedExts.push(e);
          mergedExtCount += 1;
        }
      }
      const mergedAgents = [...(state.agents ?? [])];
      for (const ag of incomingAgents) {
        if (!mergedAgents.some((x) => x.id === ag.id)) {
          mergedAgents.push(ag);
        }
      }
      const mergedWorkflows = [...(state.workflows ?? [])];
      for (const wf of incomingWorkflows) {
        if (!mergedWorkflows.some((x) => x.id === wf.id)) {
          mergedWorkflows.push(wf);
        }
      }
      const next = persistSnapshot({
        ...state,
        accounts: mergedAccounts,
        groupChats: mergedGroups,
        externalAgents: mergedExts,
        agents: mergedAgents,
        workflows: mergedWorkflows,
        routerPolicy: parsed.routerPolicy
          ? normalizeRouterPolicy(parsed.routerPolicy)
          : state.routerPolicy,
      });
      return {
        snapshot: next,
        summary: {
          addedAccounts,
          updatedAccounts,
          importedCookieAccounts: incomingAccounts.filter((a) => a.authState === "authenticated").length,
          skippedCookieAccounts: 0,
          mergedGroups: mergedGroupCount,
          mergedExternalAgents: mergedExtCount,
        },
      } satisfies ImportSyncBundleResponse as unknown as T;
    }

    case "start_lan_sync_share":
    case "start_relay_sync_share": {
      const isRelay = cmd === "start_relay_sync_share";
      const passphrase =
        (args.passphrase ? String(args.passphrase).trim() : "") ||
        Math.random().toString(36).slice(2, 10);
      const relayUrl = isRelay ? String(args.relayUrl || OFFICIAL_RELAY_URL) : null;
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const address = isRelay ? `${relayUrl}#${code}` : `maam-sync://local-${code}`;
      const syncUri = `${address}#${encodeURIComponent(passphrase)}`;
      const bundleJson = JSON.stringify({
        accounts: state.accounts,
        groupChats: state.groupChats,
        externalAgents: state.externalAgents,
      });
      const info: LanSyncShareInfo = {
        mode: isRelay ? "relay" : "lan",
        relayUrl,
        address,
        passphrase,
        syncUri,
        qrSvg: buildQrSvgPlaceholder(syncUri),
        expiresAtMs: Date.now() + 3 * 60 * 1000,
        maxDownloads: 3,
        accountCount: state.accounts.length,
        cookieAccountCount: state.accounts.filter((a) => a.authState === "authenticated").length,
      };
      activeLanShare = { info, passphrase, bundleJson };
      return info as unknown as T;
    }

    case "stop_lan_sync_share":
      activeLanShare = null;
      return undefined as unknown as T;

    case "pull_lan_sync_share": {
      const address = String(args.address ?? "").trim();
      const passphrase = String(args.passphrase ?? "").trim();
      if (!address || !passphrase) {
        throw new Error("Please enter both sync address and passphrase");
      }
      if (
        activeLanShare &&
        (activeLanShare.info.address === address || activeLanShare.info.syncUri.startsWith(address)) &&
        activeLanShare.passphrase === passphrase
      ) {
        return webInvoke<T>("import_sync_bundle", {
          bundleJson: activeLanShare.bundleJson,
          passphrase: "",
        });
      }
      throw new Error("Browser preview cannot host a LAN HTTP server; please use the Encrypted Backup File tab to export/import .maam files");
    }

    case "scan_sync_qr_code":
      return { content: "", cancelled: true } satisfies ScanQrResult as unknown as T;

    case "reveal_downloaded_file":
      return undefined as unknown as T;

    // ── SMART ROUTER & LEASE MANAGER ────────────────────────────────────────
    case "router_update_config": {
      const currentPolicy = normalizeRouterPolicy(state.routerPolicy);
      const patch = (args.config ?? args) as Partial<RouterPolicyConfig>;
      const merged = normalizeRouterPolicy({
        ...currentPolicy,
        ...patch,
        weights: {
          ...currentPolicy.weights,
          ...(patch.weights ?? {}),
        },
        accountRules: currentPolicy.accountRules,
        cooldownsUntilMs: currentPolicy.cooldownsUntilMs,
        lastAssignedMs: currentPolicy.lastAssignedMs,
      });
      const next = persistSnapshot({
        ...state,
        routerPolicy: merged,
        notice: "Smart Router policy saved",
      });
      return next as unknown as T;
    }

    case "router_upsert_account_rule": {
      const currentPolicy = normalizeRouterPolicy(state.routerPolicy);
      const rule = args.rule as AccountRuleConfig | undefined;
      if (!rule || !rule.account?.providerId || !rule.account?.uuid) {
        throw new Error("Invalid account rule target");
      }
      const sanitized: AccountRuleConfig = {
        account: rule.account,
        priority: Math.max(1, Math.min(100, Math.round(Number(rule.priority) || 50))),
        maxConcurrent: Math.max(1, Math.min(5, Math.round(Number(rule.maxConcurrent) || 1))),
        allowed: Boolean(rule.allowed),
        allowedAgentIds: Array.isArray(rule.allowedAgentIds) ? rule.allowedAgentIds.map(String) : [],
      };
      const existingIdx = currentPolicy.accountRules.findIndex((r) =>
        sameKey(r.account, sanitized.account)
      );
      const nextRules =
        existingIdx >= 0
          ? currentPolicy.accountRules.map((r, i) => (i === existingIdx ? sanitized : r))
          : [...currentPolicy.accountRules, sanitized];
      const next = persistSnapshot({
        ...state,
        routerPolicy: { ...currentPolicy, accountRules: nextRules },
        notice: "Account routing rule updated",
      });
      return next as unknown as T;
    }

    case "router_clear_cooldown": {
      const currentPolicy = normalizeRouterPolicy(state.routerPolicy);
      const account = args.account as AccountKey | undefined;
      const nextCooldowns = { ...currentPolicy.cooldownsUntilMs };
      if (account?.providerId && account?.uuid) {
        delete nextCooldowns[accountKeyStr(account)];
      } else {
        for (const k of Object.keys(nextCooldowns)) delete nextCooldowns[k];
      }
      const next = persistSnapshot({
        ...state,
        routerPolicy: { ...currentPolicy, cooldownsUntilMs: nextCooldowns },
        notice: account ? "Account cooldown cleared" : "All account cooldowns cleared",
      });
      return next as unknown as T;
    }

    case "router_release_lease": {
      const leaseId = String(args.leaseId ?? "");
      const leases = leaseId
        ? releaseAccountLease(state.accountLeases ?? [], leaseId)
        : ([] as AccountLease[]);
      const next = persistSnapshot({
        ...state,
        accountLeases: leases,
        notice: leaseId ? "Account reservation released" : "All reservations released",
      });
      return next as unknown as T;
    }

    case "router_preview_allocation": {
      const providerId = String(args.providerId ?? state.selectedProviderId ?? "muse");
      const strategyOverride = args.strategy ? (String(args.strategy) as RoutingStrategy) : undefined;
      const agentId = args.agentId ? String(args.agentId) : null;
      const agent = agentId ? (state.agents ?? []).find((a) => a.id === agentId) : undefined;
      const preview: RoutingDecisionPreview = previewRoutingDecision({
        accounts: state.accounts,
        policy: normalizeRouterPolicy(state.routerPolicy),
        leases: state.accountLeases ?? [],
        providerId,
        strategyOverride: strategyOverride ?? agent?.resourcePolicy.routingMode,
        agentId: agent?.id ?? null,
        accountPool: agent?.resourcePolicy.accountPool,
        accountErrors: state.accountErrors,
      });
      return preview as unknown as T;
    }

    // ── AGENT PROFILES ──────────────────────────────────────────────────────
    case "agent_upsert": {
      const raw = (args.agent ?? args) as Partial<AgentProfile>;
      const name = String(raw.name ?? "").trim();
      const role = String(raw.role ?? "").trim();
      if (!name) throw new Error("Agent name cannot be empty");
      if (!role) throw new Error("Agent role cannot be empty");
      const now = Date.now();
      const existing = (state.agents ?? []).find((a) => a.id === raw.id);
      const nextAgent: AgentProfile = {
        id: existing?.id ?? `agent_${randomUuid().slice(0, 8)}`,
        name,
        role,
        description: String(raw.description ?? "").trim(),
        enabled: raw.enabled ?? true,
        instructions: String(raw.instructions ?? "").trim() || `Perform the "${role}" role clearly and accurately.`,
        capabilities: Array.isArray(raw.capabilities)
          ? raw.capabilities.map((c) => String(c).trim()).filter(Boolean)
          : [],
        outputFormat: String(raw.outputFormat ?? "Structured Markdown").trim() || "Structured Markdown",
        reviewRequired: Boolean(raw.reviewRequired),
        resourcePolicy: {
          targetType: raw.resourcePolicy?.targetType ?? "smart_router",
          providerId: raw.resourcePolicy?.providerId ?? state.selectedProviderId ?? "muse",
          routingMode: raw.resourcePolicy?.routingMode ?? "smart_balanced",
          pinnedAccount: raw.resourcePolicy?.pinnedAccount ?? null,
          externalAgentId: raw.resourcePolicy?.externalAgentId ?? null,
          accountPool: Array.isArray(raw.resourcePolicy?.accountPool) ? raw.resourcePolicy.accountPool : [],
          maxConcurrentTasks: Math.max(1, Math.min(5, Number(raw.resourcePolicy?.maxConcurrentTasks) || 1)),
        },
        stats: existing?.stats ?? { runs: 0, successes: 0, failures: 0, avgLatencyMs: 0 },
        createdAtMs: existing?.createdAtMs ?? now,
      };
      const nextAgents = existing
        ? (state.agents ?? []).map((a) => (a.id === existing.id ? nextAgent : a))
        : [...(state.agents ?? []), nextAgent];
      const next = persistSnapshot({
        ...state,
        agents: nextAgents,
        notice: existing ? `Updated agent "${nextAgent.name}"` : `Created agent "${nextAgent.name}"`,
      });
      return next as unknown as T;
    }

    case "agent_delete": {
      const agentId = String(args.agentId ?? "");
      const target = (state.agents ?? []).find((a) => a.id === agentId);
      if (!target) throw new Error("Agent not found");
      const usedInWorkflow = (state.workflows ?? []).find((wf) =>
        wf.steps.some(
          (s) =>
            s.agentId === agentId ||
            (s.parallelBranches ?? []).some((b) => b.agentId === agentId)
        )
      );
      if (usedInWorkflow) {
        throw new Error(
          `Agent "${target.name}" is used in pipeline "${usedInWorkflow.name}". Reassign or remove it from that pipeline first.`
        );
      }
      const next = persistSnapshot({
        ...state,
        agents: (state.agents ?? []).filter((a) => a.id !== agentId),
        notice: `Deleted agent "${target.name}"`,
      });
      return next as unknown as T;
    }

    case "agent_toggle": {
      const agentId = String(args.agentId ?? "");
      const enabled = args.enabled !== undefined ? Boolean(args.enabled) : undefined;
      const next = persistSnapshot({
        ...state,
        agents: (state.agents ?? []).map((a) =>
          a.id === agentId ? { ...a, enabled: enabled ?? !a.enabled } : a
        ),
      });
      return next as unknown as T;
    }

    case "agent_apply_template": {
      const templateId = String(args.templateId ?? "");
      const tpl = AGENT_TEMPLATES.find((t) => t.id === templateId);
      if (!tpl) throw new Error("Agent template not found");
      const now = Date.now();
      const suffix = (state.agents ?? []).filter((a) => a.name.startsWith(tpl.profile.name)).length;
      const created: AgentProfile = {
        ...tpl.profile,
        id: `agent_${tpl.id}_${randomUuid().slice(0, 6)}`,
        name: suffix > 0 ? `${tpl.profile.name} ${suffix + 1}` : tpl.profile.name,
        stats: { runs: 0, successes: 0, failures: 0, avgLatencyMs: 0 },
        createdAtMs: now,
      };
      const next = persistSnapshot({
        ...state,
        agents: [...(state.agents ?? []), created],
        notice: `Added "${created.name}" from template`,
      });
      return next as unknown as T;
    }

    // ── WORKFLOW PIPELINES ──────────────────────────────────────────────────
    case "workflow_upsert": {
      const raw = (args.workflow ?? args) as Partial<WorkflowPipeline>;
      const now = Date.now();
      const existing = (state.workflows ?? []).find((w) => w.id === raw.id);
      const candidate: WorkflowPipeline = {
        id: existing?.id ?? `wf_${randomUuid().slice(0, 8)}`,
        name: String(raw.name ?? "").trim(),
        description: String(raw.description ?? "").trim(),
        version: (existing?.version ?? 0) + 1,
        steps: Array.isArray(raw.steps) ? (raw.steps as PipelineStep[]) : [],
        createdAtMs: existing?.createdAtMs ?? now,
        updatedAtMs: now,
      };
      const validation = validateWorkflowPipeline(candidate, state.agents ?? []);
      if (!validation.valid) {
        throw new Error(validation.errors[0] ?? "Workflow pipeline validation failed");
      }
      const nextWorkflows = existing
        ? (state.workflows ?? []).map((w) => (w.id === existing.id ? candidate : w))
        : [...(state.workflows ?? []), candidate];
      const next = persistSnapshot({
        ...state,
        workflows: nextWorkflows,
        notice: existing
          ? `Saved pipeline "${candidate.name}"`
          : `Created pipeline "${candidate.name}"`,
      });
      return next as unknown as T;
    }

    case "workflow_delete": {
      const workflowId = String(args.workflowId ?? "");
      const workflows = state.workflows ?? [];
      if (workflows.length <= 1) {
        throw new Error("Keep at least one workflow pipeline");
      }
      const next = persistSnapshot({
        ...state,
        workflows: workflows.filter((w) => w.id !== workflowId),
        notice: "Workflow pipeline deleted",
      });
      return next as unknown as T;
    }

    // ── ORCHESTRATED TASKS ──────────────────────────────────────────────────
    case "task_create_and_start": {
      const title = String(args.title ?? "").trim();
      const objective = String(args.objective ?? "").trim();
      const context = String(args.context ?? "").trim();
      const outputFormat = String(args.outputFormat ?? "Executive Markdown Report").trim() || "Executive Markdown Report";
      const workflowId = String(args.workflowId ?? "");
      const routingStrategy = String(
        args.routingStrategy ?? state.routerPolicy?.strategy ?? "smart_balanced"
      ) as RoutingStrategy;

      if (!title) throw new Error("Please enter a task title");
      if (!objective) throw new Error("Please enter a task objective");
      const workflow = (state.workflows ?? []).find((w) => w.id === workflowId);
      if (!workflow) throw new Error("Selected workflow pipeline not found");

      const agents = state.agents ?? [];
      const validation = validateWorkflowPipeline(workflow, agents);
      if (!validation.valid) {
        throw new Error(validation.errors[0] ?? "Selected pipeline is invalid");
      }

      const now = Date.now();
      const taskId = `task_${randomUuid().slice(0, 8)}`;
      const task: OrchestratedTask = {
        id: taskId,
        title,
        objective,
        context,
        outputFormat,
        workflowId: workflow.id,
        workflowName: workflow.name,
        routingStrategy,
        status: "running",
        currentStepIndex: 0,
        pauseRequested: false,
        cancelRequested: false,
        createdAtMs: now,
        startedAtMs: now,
        completedAtMs: null,
        nodeExecutions: buildInitialNodeExecutions(workflow.steps, agents),
        artifacts: [],
        events: [
          {
            id: `evt_start_${now}`,
            timestampMs: now,
            level: "info",
            event: "Task Launched",
            detail: `Started "${title}" on "${workflow.name}" (${routingStrategy})`,
          },
        ],
        error: null,
      };

      const next = persistSnapshot({
        ...state,
        tasks: [task, ...(state.tasks ?? [])],
        activeTaskId: taskId,
        activeGroupId: null,
      });

      void runOrchestratedTaskLoop(taskId, loadSnapshot, mutateStateAndBroadcast);
      return next as unknown as T;
    }

    case "task_select": {
      const taskId = args.taskId ? String(args.taskId) : null;
      const next = persistSnapshot({
        ...state,
        activeTaskId: taskId,
      });
      return next as unknown as T;
    }

    case "task_pause": {
      const taskId = String(args.taskId ?? "");
      const next = persistSnapshot({
        ...state,
        tasks: (state.tasks ?? []).map((t) =>
          t.id === taskId && t.status === "running"
            ? { ...t, pauseRequested: true }
            : t
        ),
        notice: "Pause requested; finishing current step cleanly",
      });
      return next as unknown as T;
    }

    case "task_resume": {
      const taskId = String(args.taskId ?? "");
      const target = (state.tasks ?? []).find((t) => t.id === taskId);
      if (!target) throw new Error("Task not found");
      if (target.status !== "paused" && target.status !== "interrupted" && target.status !== "failed") {
        return state as unknown as T;
      }
      const next = persistSnapshot({
        ...state,
        tasks: (state.tasks ?? []).map((t) =>
          t.id !== taskId
            ? t
            : {
                ...t,
                status: "running",
                pauseRequested: false,
                cancelRequested: false,
                error: null,
                events: [
                  ...t.events,
                  {
                    id: `evt_resume_${Date.now()}`,
                    timestampMs: Date.now(),
                    level: "info",
                    event: "Task Resumed",
                    detail: `Resumed execution at stage ${t.currentStepIndex + 1}`,
                  },
                ],
              }
        ),
      });
      void runOrchestratedTaskLoop(taskId, loadSnapshot, mutateStateAndBroadcast);
      return next as unknown as T;
    }

    case "task_cancel": {
      const taskId = String(args.taskId ?? "");
      const now = Date.now();
      const target = (state.tasks ?? []).find((t) => t.id === taskId);
      if (!target) throw new Error("Task not found");
      const isIdleState = target.status === "paused" || target.status === "waiting_approval" || target.status === "pending";
      const next = persistSnapshot({
        ...state,
        accountLeases: (state.accountLeases ?? []).filter(
          (l) => !l.holderId.startsWith(`${taskId}:`)
        ),
        tasks: (state.tasks ?? []).map((t) =>
          t.id !== taskId
            ? t
            : {
                ...t,
                cancelRequested: !isIdleState,
                status: isIdleState ? "cancelled" : t.status,
                completedAtMs: isIdleState ? now : t.completedAtMs,
                nodeExecutions: isIdleState
                  ? t.nodeExecutions.map((n) =>
                      n.status === "pending" ||
                      n.status === "ready" ||
                      n.status === "waiting_approval" ||
                      n.status === "running"
                        ? { ...n, status: "cancelled", leaseId: null }
                        : n
                    )
                  : t.nodeExecutions,
                events: isIdleState
                  ? [
                      ...t.events,
                      {
                        id: `evt_cancel_${now}`,
                        timestampMs: now,
                        level: "warn",
                        event: "Task Cancelled",
                        detail: "Cancelled by user.",
                      },
                    ]
                  : t.events,
              }
        ),
      });
      return next as unknown as T;
    }

    case "task_approve_step": {
      const taskId = String(args.taskId ?? "");
      const approved = Boolean(args.approved ?? true);
      const comment = String(args.comment ?? "").trim();
      const target = (state.tasks ?? []).find((t) => t.id === taskId);
      if (!target) throw new Error("Task not found");
      if (target.status !== "waiting_approval") {
        throw new Error("Task is not waiting for approval");
      }
      const now = Date.now();
      const idx = target.currentStepIndex;

      if (!approved) {
        const next = persistSnapshot({
          ...state,
          tasks: (state.tasks ?? []).map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  status: "cancelled",
                  completedAtMs: now,
                  nodeExecutions: t.nodeExecutions.map((n, i) =>
                    i === idx
                      ? {
                          ...n,
                          status: "cancelled",
                          completedAtMs: now,
                          summary: comment || "Rejected at approval gate",
                        }
                      : i > idx
                        ? { ...n, status: "cancelled" }
                        : n
                  ),
                  events: [
                    ...t.events,
                    {
                      id: `evt_reject_${now}`,
                      timestampMs: now,
                      level: "warn",
                      event: "Approval Rejected",
                      detail: comment || "User rejected continuation at approval gate.",
                    },
                  ],
                }
          ),
        });
        return next as unknown as T;
      }

      const next = persistSnapshot({
        ...state,
        tasks: (state.tasks ?? []).map((t) =>
          t.id !== taskId
            ? t
            : {
                ...t,
                status: "running",
                currentStepIndex: idx + 1,
                nodeExecutions: t.nodeExecutions.map((n, i) =>
                  i === idx
                    ? {
                        ...n,
                        status: "completed",
                        attempt: Math.max(1, n.attempt),
                        completedAtMs: now,
                        summary: comment || "Approved by user",
                      }
                    : i === idx + 1 && n.status === "pending"
                      ? { ...n, status: "ready" }
                      : n
                ),
                events: [
                  ...t.events,
                  {
                    id: `evt_approve_${now}`,
                    timestampMs: now,
                    level: "success",
                    event: "Human Approval Granted",
                    detail: comment || "Approved by user to proceed.",
                  },
                ],
              }
        ),
      });
      void runOrchestratedTaskLoop(taskId, loadSnapshot, mutateStateAndBroadcast);
      return next as unknown as T;
    }

    case "task_retry_stage": {
      const taskId = String(args.taskId ?? "");
      const stepIndexArg =
        typeof args.stepIndex === "number" ? args.stepIndex : undefined;
      const target = (state.tasks ?? []).find((t) => t.id === taskId);
      if (!target) throw new Error("Task not found");
      const failedIdx = target.nodeExecutions.findIndex((n) => n.status === "failed");
      const retryIdx =
        stepIndexArg !== undefined
          ? stepIndexArg
          : failedIdx >= 0
            ? failedIdx
            : Math.min(target.currentStepIndex, Math.max(0, target.nodeExecutions.length - 1));
      const now = Date.now();
      const stepIdToReplace = target.nodeExecutions[retryIdx]?.stepId;

      const next = persistSnapshot({
        ...state,
        tasks: (state.tasks ?? []).map((t) =>
          t.id !== taskId
            ? t
            : {
                ...t,
                status: "running",
                pauseRequested: false,
                cancelRequested: false,
                completedAtMs: null,
                error: null,
                currentStepIndex: retryIdx,
                artifacts: stepIdToReplace
                  ? t.artifacts.filter((a) => a.stepId !== stepIdToReplace)
                  : t.artifacts,
                nodeExecutions: t.nodeExecutions.map((n, i) =>
                  i === retryIdx
                    ? { ...n, status: "ready", error: null, leaseId: null }
                    : i > retryIdx
                      ? { ...n, status: "pending", error: null, leaseId: null }
                      : n
                ),
                events: [
                  ...t.events,
                  {
                    id: `evt_retry_${now}`,
                    timestampMs: now,
                    level: "info",
                    event: "Stage Retry Triggered",
                    detail: `Retrying stage ${retryIdx + 1}: ${t.nodeExecutions[retryIdx]?.title ?? ""}`,
                  },
                ],
              }
        ),
      });
      void runOrchestratedTaskLoop(taskId, loadSnapshot, mutateStateAndBroadcast);
      return next as unknown as T;
    }

    case "task_delete": {
      const taskId = String(args.taskId ?? "");
      const remaining = (state.tasks ?? []).filter((t) => t.id !== taskId);
      const next = persistSnapshot({
        ...state,
        tasks: remaining,
        activeTaskId: state.activeTaskId === taskId ? remaining[0]?.id ?? null : state.activeTaskId,
      });
      return next as unknown as T;
    }

    default:
      return state as unknown as T;
  }
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime()) {
    return tauriInvoke<T>(cmd, args);
  }
  return webInvoke<T>(cmd, args);
}

export async function listen<T>(
  event: string,
  handler: (evt: { payload: T }) => void
): Promise<() => void> {
  if (isTauriRuntime()) {
    return tauriListen<T>(event, handler);
  }
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  const wrapped = handler as EventCallback<unknown>;
  set.add(wrapped);
  return () => {
    set?.delete(wrapped);
  };
}
