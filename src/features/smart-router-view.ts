import type {
  AccountKey,
  AccountRuleConfig,
  ManagerSnapshot,
  ProviderId,
  ProviderInfo,
  RouterPolicyConfig,
  RoutingDecisionPreview,
  RoutingStrategy,
} from "../types";
import {
  accountKeyStr,
  normalizeRouterPolicy,
  previewRoutingDecision,
  recoverExpiredLeases,
  resolveAccountRule,
  resolveRemainingQuotaPct,
} from "../engine/smart-router";

export interface SmartRouterViewDeps {
  callCmd: <T = ManagerSnapshot>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  applySnapshot: (snap: ManagerSnapshot) => void;
  rerender: () => void;
  escapeHtml: (value: string) => string;
  renderSharedChrome: (state: ManagerSnapshot, provider: ProviderInfo) => string;
}

const STRATEGY_META: Array<{ id: RoutingStrategy; label: string; desc: string }> = [
  { id: "smart_balanced", label: "Smart Balanced", desc: "Weighted Quota + Health + Load + Priority" },
  { id: "highest_quota", label: "Highest Quota", desc: "Prioritize accounts with the most quota left" },
  { id: "least_busy", label: "Least Busy", desc: "Favor idle accounts and longest rest interval" },
  { id: "priority_based", label: "Priority Based", desc: "Strictly prefer highest configured priority" },
  { id: "manual", label: "Manual Pin", desc: "Target a single pinned primary account" },
];

let previewProviderId: ProviderId = "muse";
let previewAgentId: string = "";
let ruleProviderFilter: string = "all";
let policyDraft: RouterPolicyConfig | null = null;
let lastPreviewResult: RoutingDecisionPreview | null = null;
let savingPolicy = false;

function getPolicyDraft(state: ManagerSnapshot): RouterPolicyConfig {
  const normalized = normalizeRouterPolicy(state.routerPolicy);
  if (!policyDraft) {
    policyDraft = { ...normalized, weights: { ...normalized.weights } };
  }
  return policyDraft;
}

export function resetSmartRouterDraftFromSnapshot(state: ManagerSnapshot): void {
  const normalized = normalizeRouterPolicy(state.routerPolicy);
  policyDraft = { ...normalized, weights: { ...normalized.weights } };
}

function getPoolSummary(state: ManagerSnapshot): {
  eligible: number;
  busy: number;
  unavailable: number;
  activeLeasesCount: number;
  cooldownCount: number;
} {
  const now = Date.now();
  const policy = normalizeRouterPolicy(state.routerPolicy);
  const leases = recoverExpiredLeases(state.accountLeases ?? [], now);
  let eligible = 0;
  let busy = 0;
  let unavailable = 0;

  for (const prov of state.providers) {
    if (!prov.enabled) continue;
    const preview = previewRoutingDecision({
      accounts: state.accounts,
      policy,
      leases,
      providerId: prov.id,
      accountErrors: state.accountErrors,
      nowMs: now,
    });
    eligible += (preview.selected ? 1 : 0) + preview.alternatives.length;
    for (const ex of preview.excluded) {
      if (ex.activeLeases >= ex.maxConcurrent) busy += 1;
      else unavailable += 1;
    }
  }

  const cooldownCount = Object.values(policy.cooldownsUntilMs).filter((t) => t > now).length;
  return {
    eligible,
    busy,
    unavailable,
    activeLeasesCount: leases.length,
    cooldownCount,
  };
}

export function renderSmartRouterMiddle(
  state: ManagerSnapshot,
  provider: ProviderInfo,
  deps: SmartRouterViewDeps
): string {
  const { escapeHtml, renderSharedChrome } = deps;
  const now = Date.now();
  const policy = getPolicyDraft(state);
  const activeLeases = recoverExpiredLeases(state.accountLeases ?? [], now);
  const summary = getPoolSummary(state);

  const leasesHtml =
    activeLeases.length === 0
      ? `<div class="sr-empty-leases">No active reservations. Accounts are idle and ready.</div>`
      : activeLeases
          .map((lease) => {
            const acc = state.accounts.find(
              (a) => a.providerId === lease.account.providerId && a.uuid === lease.account.uuid
            );
            const remSecs = Math.max(1, Math.ceil((lease.expiresAtMs - now) / 1000));
            return `
              <div class="sr-lease-item">
                <div class="sr-lease-top">
                  <span class="sr-lease-acc">${escapeHtml(acc?.alias ?? lease.account.uuid.slice(0, 8))}</span>
                  <span class="sr-pill busy">${escapeHtml(lease.account.providerId.toUpperCase())}</span>
                </div>
                <div class="sr-lease-meta">
                  <span>${escapeHtml(lease.holderLabel)}</span>
                  <span>TTL ${remSecs}s</span>
                </div>
                <button class="mini-btn" data-sr-release-lease="${escapeHtml(lease.id)}" type="button">Release Lock</button>
              </div>
            `;
          })
          .join("");

  const cooldownEntries = Object.entries(policy.cooldownsUntilMs).filter(([, until]) => until > now);

  return `
    <div class="column-header">
      <div class="provider-title-wrap">
        <span class="provider-title">Smart Router</span>
        <span class="count-badge">${summary.eligible} ready</span>
      </div>
      <div class="header-actions">
        ${
          activeLeases.length > 0
            ? `<button id="sr-release-all-leases-btn" class="mini-btn" type="button">Release All</button>`
            : ""
        }
        ${
          cooldownEntries.length > 0
            ? `<button id="sr-clear-all-cooldowns-btn" class="mini-btn" type="button">Clear Cooldowns</button>`
            : ""
        }
      </div>
    </div>
    <div class="sr-middle-body">
      <div class="sr-kpi-grid">
        <div class="sr-kpi-card">
          <span class="sr-kpi-label">Eligible</span>
          <span class="sr-kpi-val ok">${summary.eligible}</span>
        </div>
        <div class="sr-kpi-card">
          <span class="sr-kpi-label">Busy Locks</span>
          <span class="sr-kpi-val ${summary.busy > 0 ? "warn" : ""}">${summary.busy}</span>
        </div>
        <div class="sr-kpi-card">
          <span class="sr-kpi-label">Unavailable</span>
          <span class="sr-kpi-val ${summary.unavailable > 0 ? "danger" : ""}">${summary.unavailable}</span>
        </div>
        <div class="sr-kpi-card">
          <span class="sr-kpi-label">Cooldowns</span>
          <span class="sr-kpi-val">${summary.cooldownCount}</span>
        </div>
      </div>

      <div class="sr-side-section">
        <div class="sr-side-title">Active Strategy</div>
        <div class="sr-strategy-stack">
          ${STRATEGY_META.map(
            (s) => `
              <button
                class="sr-strategy-chip ${policy.strategy === s.id ? "active" : ""}"
                data-sr-quick-strategy="${s.id}"
                type="button"
              >
                <span class="sr-strategy-name">${escapeHtml(s.label)}</span>
                <span class="sr-strategy-desc">${escapeHtml(s.desc)}</span>
              </button>
            `
          ).join("")}
        </div>
      </div>

      <div class="sr-side-section">
        <div class="sr-side-head">
          <span class="sr-side-title">Live Account Locks (${activeLeases.length})</span>
        </div>
        <div class="sr-lease-list">${leasesHtml}</div>
      </div>
    </div>
    ${renderSharedChrome(state, provider)}
  `;
}

export function renderSmartRouterStage(
  state: ManagerSnapshot,
  deps: SmartRouterViewDeps
): string {
  const { escapeHtml } = deps;
  const now = Date.now();
  const savedPolicy = normalizeRouterPolicy(state.routerPolicy);
  const draft = getPolicyDraft(state);
  const leases = recoverExpiredLeases(state.accountLeases ?? [], now);

  const enabledProviders = state.providers.filter((p) => p.enabled);
  if (!enabledProviders.some((p) => p.id === previewProviderId)) {
    previewProviderId = enabledProviders[0]?.id ?? "muse";
  }

  const agents = state.agents ?? [];
  const selectedAgent = previewAgentId ? agents.find((a) => a.id === previewAgentId) ?? null : null;

  const currentPreview =
    lastPreviewResult && lastPreviewResult.providerId === previewProviderId
      ? lastPreviewResult
      : previewRoutingDecision({
          accounts: state.accounts,
          policy: draft,
          leases,
          providerId: previewProviderId,
          strategyOverride: selectedAgent?.resourcePolicy.routingMode ?? draft.strategy,
          agentId: selectedAgent?.id ?? null,
          accountPool: selectedAgent?.resourcePolicy.accountPool,
          accountErrors: state.accountErrors,
          nowMs: now,
        });

  const providerAccountsForManual = state.accounts.filter((a) => a.providerId === previewProviderId);
  const filteredAccounts =
    ruleProviderFilter === "all"
      ? state.accounts
      : state.accounts.filter((a) => a.providerId === ruleProviderFilter);

  const accountsRowsHtml =
    filteredAccounts.length === 0
      ? `<div class="sr-empty-leases">No accounts match the selected provider filter.</div>`
      : filteredAccounts
          .map((acc) => {
            const key: AccountKey = { providerId: acc.providerId, uuid: acc.uuid };
            const keyStr = accountKeyStr(key);
            const rule = resolveAccountRule(savedPolicy, key);
            const quota = resolveRemainingQuotaPct(acc);
            const activeCount = leases.filter(
              (l) => l.account.providerId === acc.providerId && l.account.uuid === acc.uuid
            ).length;
            const cdUntil = savedPolicy.cooldownsUntilMs[keyStr] ?? 0;
            const cdSecs = cdUntil > now ? Math.ceil((cdUntil - now) / 1000) : 0;
            const pageErr = (state.accountErrors ?? []).find(
              (e) => e.providerId === acc.providerId && e.uuid === acc.uuid
            );
            const healthLabel =
              acc.authState !== "authenticated"
                ? "Signed out"
                : pageErr
                  ? "Page error"
                  : cdSecs > 0
                    ? `Cooldown ${cdSecs}s`
                    : activeCount >= rule.maxConcurrent
                      ? `Busy (${activeCount}/${rule.maxConcurrent})`
                      : "Healthy";
            const healthTone =
              acc.authState !== "authenticated" || pageErr
                ? "danger"
                : cdSecs > 0 || activeCount >= rule.maxConcurrent
                  ? "warn"
                  : "ok";

            return `
              <div class="sr-rule-row" data-sr-rule-key="${escapeHtml(keyStr)}">
                <div class="sr-rule-ident">
                  <div class="sr-rule-name-line">
                    <span class="sr-provider-tag">${escapeHtml(acc.providerId.toUpperCase())}</span>
                    <strong class="sr-rule-alias">${escapeHtml(acc.alias)}</strong>
                  </div>
                  <div class="sr-rule-sub">
                    <span class="sr-pill ${healthTone}">${escapeHtml(healthLabel)}</span>
                    <span class="sr-quota-tag">Quota: ${quota.known ? `${quota.remainingPct}% left` : "Est. 60%"}</span>
                    <span class="sr-lock-tag">Locks: ${activeCount}/${rule.maxConcurrent}</span>
                  </div>
                </div>
                <div class="sr-rule-controls">
                  <label class="sr-toggle-inline" title="Allow Smart Router to allocate this account">
                    <input type="checkbox" class="sr-rule-allowed-cb" data-sr-provider="${escapeHtml(acc.providerId)}" data-sr-uuid="${escapeHtml(acc.uuid)}" ${rule.allowed ? "checked" : ""} />
                    <span>Allow</span>
                  </label>
                  <label class="sr-compact-field">
                    <span>Priority</span>
                    <input type="number" min="1" max="100" class="sr-num-input sr-rule-priority-input" data-sr-provider="${escapeHtml(acc.providerId)}" data-sr-uuid="${escapeHtml(acc.uuid)}" value="${rule.priority}" />
                  </label>
                  <label class="sr-compact-field">
                    <span>Max Locks</span>
                    <input type="number" min="1" max="5" class="sr-num-input sr-rule-conc-input" data-sr-provider="${escapeHtml(acc.providerId)}" data-sr-uuid="${escapeHtml(acc.uuid)}" value="${rule.maxConcurrent}" />
                  </label>
                  <button class="mini-btn primary-text" data-sr-save-rule="${escapeHtml(keyStr)}" type="button">Apply</button>
                  ${
                    cdSecs > 0
                      ? `<button class="mini-btn" data-sr-clear-cd="${escapeHtml(keyStr)}" type="button">Clear Cooldown</button>`
                      : ""
                  }
                </div>
              </div>
            `;
          })
          .join("");

  const selected = currentPreview.selected;

  return `
    <main class="sr-stage">
      <div class="sr-stage-header">
        <div>
          <h1 class="sr-title">Smart Router & Account Pool Control</h1>
          <p class="sr-subtitle">
            Unified quota-aware scheduling and session lock governance shared across Group Chat auto-channels and Agent Center pipelines.
          </p>
        </div>
        <div class="sr-header-controls">
          <select id="sr-preview-provider-select" class="sr-select" aria-label="Preview provider">
            ${enabledProviders
              .map(
                (p) =>
                  `<option value="${escapeHtml(p.id)}" ${p.id === previewProviderId ? "selected" : ""}>Provider: ${escapeHtml(p.shortName)}</option>`
              )
              .join("")}
          </select>
          <select id="sr-preview-agent-select" class="sr-select" aria-label="Preview agent filter">
            <option value="">Any Agent (Global Policy)</option>
            ${agents
              .map(
                (a) =>
                  `<option value="${escapeHtml(a.id)}" ${a.id === previewAgentId ? "selected" : ""}>Agent: ${escapeHtml(a.name)}</option>`
              )
              .join("")}
          </select>
          <button id="sr-run-preview-btn" class="btn primary" type="button">Simulate Decision</button>
        </div>
      </div>

      <div class="sr-grid">
        <section class="sr-card">
          <div class="sr-card-head">
            <h2>Routing Policy & Safety Guards</h2>
            <button id="sr-save-policy-btn" class="btn primary" type="button" ${savingPolicy ? "disabled" : ""}>
              ${savingPolicy ? "Saving..." : "Save Policy"}
            </button>
          </div>
          <div class="sr-form-grid">
            <label class="sr-field">
              <span>Routing Strategy</span>
              <select id="sr-strategy-select" class="sr-select">
                ${STRATEGY_META.map(
                  (s) =>
                    `<option value="${s.id}" ${draft.strategy === s.id ? "selected" : ""}>${escapeHtml(s.label)}</option>`
                ).join("")}
              </select>
            </label>
            <label class="sr-field">
              <span>Minimum Quota Guard (%)</span>
              <input id="sr-min-quota-input" class="sr-input" type="number" min="0" max="100" value="${draft.minQuotaPercent}" />
            </label>
            <label class="sr-field">
              <span>Default Concurrency / Account</span>
              <input id="sr-default-conc-input" class="sr-input" type="number" min="1" max="5" value="${draft.defaultMaxConcurrent}" />
            </label>
            <label class="sr-field">
              <span>Failure Cooldown (seconds)</span>
              <input id="sr-cooldown-secs-input" class="sr-input" type="number" min="0" max="600" value="${draft.cooldownSecs}" />
            </label>
            <label class="sr-field">
              <span>Failure Handling</span>
              <select id="sr-on-failure-select" class="sr-select">
                <option value="alternate" ${draft.onFailure === "alternate" ? "selected" : ""}>Switch to Alternate Account</option>
                <option value="retry" ${draft.onFailure === "retry" ? "selected" : ""}>Retry Same Account</option>
                <option value="stop" ${draft.onFailure === "stop" ? "selected" : ""}>Halt Task</option>
              </select>
            </label>
            <label class="sr-field">
              <span>Manual Target Account</span>
              <select id="sr-manual-account-select" class="sr-select">
                <option value="">Auto / Best Eligible</option>
                ${providerAccountsForManual
                  .map((a) => {
                    const val = `${a.providerId}:${a.uuid}`;
                    const isSel =
                      draft.manualAccount?.providerId === a.providerId &&
                      draft.manualAccount?.uuid === a.uuid;
                    return `<option value="${escapeHtml(val)}" ${isSel ? "selected" : ""}>${escapeHtml(a.alias)}</option>`;
                  })
                  .join("")}
              </select>
            </label>
          </div>

          <div class="sr-weights-box">
            <div class="sr-weights-title">Smart Balanced Scoring Weights</div>
            <div class="sr-weights-row">
              <label class="sr-weight-chip">
                <span>Quota</span>
                <input id="sr-w-quota" type="number" step="0.05" min="0" max="1" value="${draft.weights.quota}" />
              </label>
              <label class="sr-weight-chip">
                <span>Health</span>
                <input id="sr-w-health" type="number" step="0.05" min="0" max="1" value="${draft.weights.health}" />
              </label>
              <label class="sr-weight-chip">
                <span>Idle Load</span>
                <input id="sr-w-load" type="number" step="0.05" min="0" max="1" value="${draft.weights.load}" />
              </label>
              <label class="sr-weight-chip">
                <span>Priority</span>
                <input id="sr-w-priority" type="number" step="0.05" min="0" max="1" value="${draft.weights.priority}" />
              </label>
              <label class="sr-toggle-inline sr-fallback-cb">
                <input id="sr-allow-fallback-cb" type="checkbox" ${draft.allowFallback ? "checked" : ""} />
                <span>Allow fallback if primary busy</span>
              </label>
            </div>
          </div>
        </section>

        <section class="sr-card">
          <div class="sr-card-head">
            <h2>Live Routing Decision Preview</h2>
            <span class="sr-pill ${selected ? "ok" : "danger"}">
              ${selected ? `Selected: ${escapeHtml(selected.account.alias)}` : "No Eligible Account"}
            </span>
          </div>

          ${
            selected
              ? `
                <div class="sr-winner-box">
                  <div class="sr-winner-head">
                    <div>
                      <div class="sr-winner-name">${escapeHtml(selected.account.alias)}</div>
                      <div class="sr-winner-sub">
                        Provider ${escapeHtml(selected.account.providerId.toUpperCase())} · Strategy: ${escapeHtml(currentPreview.strategy)} · Remaining Quota: ${selected.remainingQuotaPct}%
                      </div>
                    </div>
                    <div class="sr-score-badge">${Math.round(selected.score * 100)}<span>/100</span></div>
                  </div>
                  <div class="sr-score-bars">
                    <div class="sr-bar-item"><span>Quota</span><div class="sr-bar-track"><div style="width:${Math.round(selected.quotaScore * 100)}%"></div></div><strong>${Math.round(selected.quotaScore * 100)}%</strong></div>
                    <div class="sr-bar-item"><span>Health</span><div class="sr-bar-track"><div style="width:${Math.round(selected.healthScore * 100)}%"></div></div><strong>${Math.round(selected.healthScore * 100)}%</strong></div>
                    <div class="sr-bar-item"><span>Idle</span><div class="sr-bar-track"><div style="width:${Math.round(selected.loadScore * 100)}%"></div></div><strong>${Math.round(selected.loadScore * 100)}%</strong></div>
                    <div class="sr-bar-item"><span>Priority</span><div class="sr-bar-track"><div style="width:${Math.round(selected.priorityScore * 100)}%"></div></div><strong>${Math.round(selected.priorityScore * 100)}%</strong></div>
                  </div>
                </div>
              `
              : `<div class="sr-no-winner">No account met current eligibility rules. Adjust Minimum Quota Guard, sign in an account, or clear active locks/cooldowns.</div>`
          }

          <div class="sr-reasoning-cols">
            <div>
              <div class="sr-subhead">Explainability Reasoning</div>
              <ul class="sr-reason-list">
                ${currentPreview.reasoning.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
              </ul>
            </div>
            <div>
              <div class="sr-subhead">Fallbacks (${currentPreview.alternatives.length}) & Excluded (${currentPreview.excluded.length})</div>
              <div class="sr-alt-list">
                ${
                  currentPreview.alternatives.length === 0 && currentPreview.excluded.length === 0
                    ? `<span class="sr-muted-line">Only one account registered for this provider.</span>`
                    : ""
                }
                ${currentPreview.alternatives
                  .map(
                    (alt, i) => `
                      <div class="sr-alt-item ok">
                        <span>Fallback #${i + 1}: <strong>${escapeHtml(alt.account.alias)}</strong></span>
                        <span>${Math.round(alt.score * 100)}/100 · ${alt.remainingQuotaPct}% quota</span>
                      </div>
                    `
                  )
                  .join("")}
                ${currentPreview.excluded
                  .map(
                    (ex) => `
                      <div class="sr-alt-item excluded">
                        <span>Excluded: <strong>${escapeHtml(ex.account.alias)}</strong></span>
                        <span>${escapeHtml(ex.reasons[0] ?? "Unavailable")}</span>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </div>
          </div>
        </section>
      </div>

        <section class="sr-card">
          <div class="sr-card-head">
            <h2>OpenAI API Gateway & Per-Account Proxy</h2>
            <span class="sr-pill ok">Active</span>
          </div>
          <div class="sr-form-grid" style="gap:10px; font-size:12px; color:var(--text-sub);">
            <p style="margin:0; line-height:1.5;">
              <strong>External API Server (/v1):</strong> Connect external AI clients (Cursor, Cline, Python SDK) directly to <code>http://localhost:3000/v1</code> with Bearer API Key authentication to run multi-agent workflows.
            </p>
            <p style="margin:0; line-height:1.5;">
              <strong>Account Proxies (HTTP / SOCKS5):</strong> Bind individual proxies per account to bypass regional blocks (such as Meta/Muse video generation country/region restrictions) and rotate IPs securely.
            </p>
            <div style="display:flex; gap:8px; margin-top:6px;">
              <button class="mini-btn primary-text" type="button" onclick="alert('API Gateway endpoints (/v1/chat/completions, /v1/images, /v1/videos) are ready for external clients.')">API Status</button>
              <button class="mini-btn" type="button" onclick="alert('Proxy management is available under account settings in the provider panel.')">Proxy Config</button>
            </div>
          </div>
        </section>

      <section class="sr-card sr-rules-card">
        <div class="sr-card-head">
          <h2>Per-Account Routing Rules</h2>
          <div class="sr-filter-tabs">
            <button class="mini-btn ${ruleProviderFilter === "all" ? "primary-text" : ""}" data-sr-rule-filter="all" type="button">All (${state.accounts.length})</button>
            ${enabledProviders
              .map(
                (p) =>
                  `<button class="mini-btn ${ruleProviderFilter === p.id ? "primary-text" : ""}" data-sr-rule-filter="${escapeHtml(p.id)}" type="button">${escapeHtml(p.shortName)}</button>`
              )
              .join("")}
          </div>
        </div>
        <div class="sr-rules-list">${accountsRowsHtml}</div>
      </section>
    </main>
  `;
}

export function bindSmartRouterEvents(
  state: ManagerSnapshot,
  deps: SmartRouterViewDeps
): void {
  const { callCmd, applySnapshot, rerender } = deps;

  const readDraftInputs = (): void => {
    const draft = getPolicyDraft(state);
    const strat = document.querySelector<HTMLSelectElement>("#sr-strategy-select")?.value as RoutingStrategy | undefined;
    const minQ = document.querySelector<HTMLInputElement>("#sr-min-quota-input")?.value;
    const defC = document.querySelector<HTMLInputElement>("#sr-default-conc-input")?.value;
    const cd = document.querySelector<HTMLInputElement>("#sr-cooldown-secs-input")?.value;
    const onFail = document.querySelector<HTMLSelectElement>("#sr-on-failure-select")?.value as RouterPolicyConfig["onFailure"] | undefined;
    const manualVal = document.querySelector<HTMLSelectElement>("#sr-manual-account-select")?.value ?? "";
    const allowFb = document.querySelector<HTMLInputElement>("#sr-allow-fallback-cb")?.checked;
    const wQ = document.querySelector<HTMLInputElement>("#sr-w-quota")?.value;
    const wH = document.querySelector<HTMLInputElement>("#sr-w-health")?.value;
    const wL = document.querySelector<HTMLInputElement>("#sr-w-load")?.value;
    const wP = document.querySelector<HTMLInputElement>("#sr-w-priority")?.value;

    let manualAccount: AccountKey | null = null;
    if (manualVal.includes(":")) {
      const [providerId, uuid] = manualVal.split(":");
      if (providerId && uuid) manualAccount = { providerId, uuid };
    }

    policyDraft = {
      ...draft,
      strategy: strat ?? draft.strategy,
      minQuotaPercent: minQ !== undefined ? Math.max(0, Math.min(100, Number(minQ) || 0)) : draft.minQuotaPercent,
      defaultMaxConcurrent: defC !== undefined ? Math.max(1, Math.min(5, Number(defC) || 1)) : draft.defaultMaxConcurrent,
      cooldownSecs: cd !== undefined ? Math.max(0, Math.min(600, Number(cd) || 0)) : draft.cooldownSecs,
      onFailure: onFail ?? draft.onFailure,
      allowFallback: allowFb !== undefined ? allowFb : draft.allowFallback,
      manualAccount,
      weights: {
        quota: wQ !== undefined ? Math.max(0, Number(wQ) || 0) : draft.weights.quota,
        health: wH !== undefined ? Math.max(0, Number(wH) || 0) : draft.weights.health,
        load: wL !== undefined ? Math.max(0, Number(wL) || 0) : draft.weights.load,
        priority: wP !== undefined ? Math.max(0, Number(wP) || 0) : draft.weights.priority,
      },
    };
  };

  document.querySelectorAll<HTMLButtonElement>("[data-sr-quick-strategy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nextStrat = btn.dataset.srQuickStrategy as RoutingStrategy | undefined;
      if (!nextStrat) return;
      readDraftInputs();
      const next = await callCmd<ManagerSnapshot>("router_update_config", {
        config: { ...getPolicyDraft(state), strategy: nextStrat },
      });
      policyDraft = null;
      lastPreviewResult = null;
      applySnapshot(next);
    });
  });

  document.querySelector("#sr-save-policy-btn")?.addEventListener("click", async () => {
    if (savingPolicy) return;
    readDraftInputs();
    savingPolicy = true;
    rerender();
    try {
      const next = await callCmd<ManagerSnapshot>("router_update_config", {
        config: getPolicyDraft(state),
      });
      policyDraft = null;
      lastPreviewResult = null;
      applySnapshot(next);
    } finally {
      savingPolicy = false;
      rerender();
    }
  });

  document.querySelector("#sr-preview-provider-select")?.addEventListener("change", (ev) => {
    previewProviderId = (ev.currentTarget as HTMLSelectElement).value;
    lastPreviewResult = null;
    rerender();
  });

  document.querySelector("#sr-preview-agent-select")?.addEventListener("change", (ev) => {
    previewAgentId = (ev.currentTarget as HTMLSelectElement).value;
    lastPreviewResult = null;
    rerender();
  });

  document.querySelector("#sr-run-preview-btn")?.addEventListener("click", async () => {
    readDraftInputs();
    const saved = await callCmd<ManagerSnapshot>("router_update_config", {
      config: getPolicyDraft(state),
    });
    const preview = await callCmd<RoutingDecisionPreview>("router_preview_allocation", {
      providerId: previewProviderId,
      agentId: previewAgentId || null,
    });
    policyDraft = null;
    lastPreviewResult = preview;
    applySnapshot(saved);
  });

  document.querySelectorAll<HTMLButtonElement>("[data-sr-rule-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ruleProviderFilter = btn.dataset.srRuleFilter ?? "all";
      rerender();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-sr-save-rule]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const keyStr = btn.dataset.srSaveRule ?? "";
      const row = document.querySelector<HTMLElement>(`[data-sr-rule-key="${CSS.escape(keyStr)}"]`);
      if (!row) return;
      const cb = row.querySelector<HTMLInputElement>(".sr-rule-allowed-cb");
      const pr = row.querySelector<HTMLInputElement>(".sr-rule-priority-input");
      const conc = row.querySelector<HTMLInputElement>(".sr-rule-conc-input");
      const providerId = cb?.dataset.srProvider ?? "";
      const uuid = cb?.dataset.srUuid ?? "";
      if (!providerId || !uuid) return;
      const existing = resolveAccountRule(normalizeRouterPolicy(state.routerPolicy), {
        providerId,
        uuid,
      });
      const rule: AccountRuleConfig = {
        account: { providerId, uuid },
        allowed: cb ? cb.checked : existing.allowed,
        priority: pr ? Math.max(1, Math.min(100, Number(pr.value) || 50)) : existing.priority,
        maxConcurrent: conc ? Math.max(1, Math.min(5, Number(conc.value) || 1)) : existing.maxConcurrent,
        allowedAgentIds: existing.allowedAgentIds,
      };
      const next = await callCmd<ManagerSnapshot>("router_upsert_account_rule", { rule });
      lastPreviewResult = null;
      applySnapshot(next);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-sr-clear-cd]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const keyStr = btn.dataset.srClearCd ?? "";
      const [providerId, uuid] = keyStr.split(":");
      if (!providerId || !uuid) return;
      const next = await callCmd<ManagerSnapshot>("router_clear_cooldown", {
        account: { providerId, uuid },
      });
      lastPreviewResult = null;
      applySnapshot(next);
    });
  });

  document.querySelector("#sr-clear-all-cooldowns-btn")?.addEventListener("click", async () => {
    const next = await callCmd<ManagerSnapshot>("router_clear_cooldown", {});
    lastPreviewResult = null;
    applySnapshot(next);
  });

  document.querySelectorAll<HTMLButtonElement>("[data-sr-release-lease]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const leaseId = btn.dataset.srReleaseLease;
      if (!leaseId) return;
      const next = await callCmd<ManagerSnapshot>("router_release_lease", { leaseId });
      lastPreviewResult = null;
      applySnapshot(next);
    });
  });

  document.querySelector("#sr-release-all-leases-btn")?.addEventListener("click", async () => {
    const next = await callCmd<ManagerSnapshot>("router_release_lease", {});
    lastPreviewResult = null;
    applySnapshot(next);
  });
}
