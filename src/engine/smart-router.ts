import type {
  AccountKey,
  AccountLease,
  AccountPageError,
  AccountRecord,
  AccountRuleConfig,
  ProviderId,
  RouterCandidateEval,
  RouterPolicyConfig,
  RoutingDecisionPreview,
  RoutingStrategy,
} from "../types";

export const DEFAULT_LEASE_TTL_MS = 120_000;

export function accountKeyStr(key: AccountKey): string {
  return `${key.providerId}:${key.uuid}`;
}

export function sameAccount(a: AccountKey | null | undefined, b: AccountKey | null | undefined): boolean {
  return Boolean(a && b && a.providerId === b.providerId && a.uuid === b.uuid);
}

export function defaultRouterPolicy(): RouterPolicyConfig {
  return {
    strategy: "smart_balanced",
    minQuotaPercent: 10,
    defaultMaxConcurrent: 1,
    cooldownSecs: 45,
    onFailure: "alternate",
    allowFallback: true,
    weights: {
      quota: 0.4,
      health: 0.25,
      load: 0.2,
      priority: 0.15,
    },
    manualAccount: null,
    accountRules: [],
    cooldownsUntilMs: {},
    lastAssignedMs: {},
  };
}

export function normalizeRouterPolicy(raw?: Partial<RouterPolicyConfig> | null): RouterPolicyConfig {
  const base = defaultRouterPolicy();
  if (!raw) return base;
  return {
    strategy: raw.strategy ?? base.strategy,
    minQuotaPercent:
      typeof raw.minQuotaPercent === "number" && Number.isFinite(raw.minQuotaPercent)
        ? Math.max(0, Math.min(100, Math.round(raw.minQuotaPercent)))
        : base.minQuotaPercent,
    defaultMaxConcurrent:
      typeof raw.defaultMaxConcurrent === "number" && Number.isFinite(raw.defaultMaxConcurrent)
        ? Math.max(1, Math.min(5, Math.round(raw.defaultMaxConcurrent)))
        : base.defaultMaxConcurrent,
    cooldownSecs:
      typeof raw.cooldownSecs === "number" && Number.isFinite(raw.cooldownSecs)
        ? Math.max(0, Math.min(600, Math.round(raw.cooldownSecs)))
        : base.cooldownSecs,
    onFailure: raw.onFailure ?? base.onFailure,
    allowFallback: raw.allowFallback ?? base.allowFallback,
    weights: {
      quota: raw.weights?.quota ?? base.weights.quota,
      health: raw.weights?.health ?? base.weights.health,
      load: raw.weights?.load ?? base.weights.load,
      priority: raw.weights?.priority ?? base.weights.priority,
    },
    manualAccount: raw.manualAccount ?? null,
    accountRules: Array.isArray(raw.accountRules) ? raw.accountRules : [],
    cooldownsUntilMs: raw.cooldownsUntilMs ? { ...raw.cooldownsUntilMs } : {},
    lastAssignedMs: raw.lastAssignedMs ? { ...raw.lastAssignedMs } : {},
  };
}

export function resolveAccountRule(policy: RouterPolicyConfig, key: AccountKey): AccountRuleConfig {
  const existing = policy.accountRules.find((r) => sameAccount(r.account, key));
  if (existing) {
    return {
      account: key,
      priority: Math.max(1, Math.min(100, existing.priority)),
      maxConcurrent: Math.max(1, Math.min(5, existing.maxConcurrent)),
      allowed: existing.allowed,
      allowedAgentIds: Array.isArray(existing.allowedAgentIds) ? existing.allowedAgentIds : [],
    };
  }
  return {
    account: key,
    priority: 50,
    maxConcurrent: Math.max(1, policy.defaultMaxConcurrent),
    allowed: true,
    allowedAgentIds: [],
  };
}

export function resolveRemainingQuotaPct(acc: AccountRecord): {
  remainingPct: number;
  known: boolean;
  depleted: boolean;
  low: boolean;
} {
  const text = (acc.quotaText ?? "").toLowerCase();
  const textDepleted =
    text.includes("exhausted") ||
    text.includes("depleted") ||
    text.includes("用尽") ||
    text.includes("耗尽");
  const textLow = /\blow\b/.test(text) || text.includes("偏低");

  if (acc.quotaDetail) {
    const planUsed = acc.quotaDetail.planUsedPercent;
    const extraUsed = acc.quotaDetail.extraUsedPercent;
    if (planUsed === null && /unlimited|无限/i.test(acc.quotaDetail.planValue)) {
      return {
        remainingPct: 100,
        known: true,
        depleted: false,
        low: false,
      };
    }
    const extraIsCap = Boolean(
      acc.quotaDetail.extraLabel && /monthly|月/i.test(acc.quotaDetail.extraLabel)
    );
    if (typeof planUsed === "number") {
      let planRem = Math.max(0, Math.min(100, 100 - planUsed));
      if (extraIsCap && typeof extraUsed === "number") {
        planRem = Math.min(planRem, Math.max(0, 100 - extraUsed));
      }
      if (planRem > 0 && !textDepleted) {
        return {
          remainingPct: planRem,
          known: true,
          depleted: false,
          low: planRem <= 20 || textLow,
        };
      }
      if (!extraIsCap && typeof extraUsed === "number") {
        const extraRem = Math.max(0, Math.min(100, 100 - extraUsed));
        return {
          remainingPct: extraRem,
          known: true,
          depleted: extraRem <= 0,
          low: extraRem <= 20 || textLow,
        };
      }
      return {
        remainingPct: 0,
        known: true,
        depleted: true,
        low: true,
      };
    }
  }

  if (typeof acc.quotaPercent === "number" && Number.isFinite(acc.quotaPercent)) {
    // Notice: in existing app AccountRecord, quotaPercent can represent remaining or used depending on provider;
    // when quotaText mentions e.g. "78%" or quotaPercent=78 while planUsedPercent=22, remaining is max(0, quotaPercent)
    // Wait: let's check both possibilities safely:
    if (textDepleted) {
      return { remainingPct: 0, known: true, depleted: true, low: true };
    }
    const val = Math.max(0, Math.min(100, acc.quotaPercent));
    return {
      remainingPct: val,
      known: true,
      depleted: val <= 0,
      low: val <= 20 || textLow,
    };
  }

  if (textDepleted) {
    return { remainingPct: 0, known: true, depleted: true, low: true };
  }
  return {
    remainingPct: 60,
    known: false,
    depleted: false,
    low: textLow,
  };
}

export function recoverExpiredLeases(leases: AccountLease[], nowMs = Date.now()): AccountLease[] {
  return leases.filter((l) => l.expiresAtMs > nowMs);
}

export interface EvaluateRoutingParams {
  accounts: AccountRecord[];
  policy: RouterPolicyConfig;
  leases: AccountLease[];
  providerId: ProviderId;
  strategyOverride?: RoutingStrategy;
  agentId?: string | null;
  accountPool?: AccountKey[];
  excludedAccounts?: AccountKey[];
  accountErrors?: AccountPageError[];
  nowMs?: number;
}

export function previewRoutingDecision(params: EvaluateRoutingParams): RoutingDecisionPreview {
  const nowMs = params.nowMs ?? Date.now();
  const policy = normalizeRouterPolicy(params.policy);
  const strategy = params.strategyOverride ?? policy.strategy;
  const activeLeases = recoverExpiredLeases(params.leases, nowMs);

  const candidates = params.accounts.filter((a) => a.providerId === params.providerId);
  const evals: RouterCandidateEval[] = candidates.map((acc) => {
    const key: AccountKey = { providerId: acc.providerId, uuid: acc.uuid };
    const keyStr = accountKeyStr(key);
    const rule = resolveAccountRule(policy, key);
    const reasons: string[] = [];
    let eligible = true;

    if (!rule.allowed) {
      eligible = false;
      reasons.push("Excluded by account routing rule");
    }
    if (
      params.agentId &&
      rule.allowedAgentIds.length > 0 &&
      !rule.allowedAgentIds.includes(params.agentId)
    ) {
      eligible = false;
      reasons.push(`Not permitted for agent "${params.agentId}"`);
    }
    if (
      params.accountPool &&
      params.accountPool.length > 0 &&
      !params.accountPool.some((p) => sameAccount(p, key))
    ) {
      eligible = false;
      reasons.push("Outside agent's allowed account pool");
    }
    if (params.excludedAccounts?.some((ex) => sameAccount(ex, key))) {
      eligible = false;
      reasons.push("Explicitly excluded for this step");
    }
    if (acc.authState !== "authenticated") {
      eligible = false;
      reasons.push(acc.authState === "logged_out" ? "Account is signed out" : "Auth status unknown");
    }
    if (acc.cookieExpiresAtMs !== null && acc.cookieExpiresAtMs <= nowMs) {
      eligible = false;
      reasons.push("Session cookies expired");
    }
    const pageErr = params.accountErrors?.find(
      (e) => e.providerId === acc.providerId && e.uuid === acc.uuid
    );
    if (pageErr) {
      eligible = false;
      reasons.push(`Page error: ${pageErr.message}`);
    }

    const quota = resolveRemainingQuotaPct(acc);
    if (quota.depleted) {
      eligible = false;
      reasons.push("Quota exhausted");
    } else if (quota.known && quota.remainingPct < policy.minQuotaPercent) {
      eligible = false;
      reasons.push(`Remaining quota ${quota.remainingPct}% below minimum ${policy.minQuotaPercent}%`);
    }

    const cooldownUntil = policy.cooldownsUntilMs[keyStr] ?? 0;
    const inCooldown = cooldownUntil > nowMs;
    const cooldownRemainingSecs = inCooldown ? Math.ceil((cooldownUntil - nowMs) / 1000) : 0;
    if (inCooldown) {
      eligible = false;
      reasons.push(`Cooling down (${cooldownRemainingSecs}s remaining)`);
    }

    const activeCount = activeLeases.filter((l) => sameAccount(l.account, key)).length;
    if (activeCount >= rule.maxConcurrent) {
      eligible = false;
      reasons.push(`Busy (${activeCount}/${rule.maxConcurrent} active reservation)`);
    }

    if (strategy === "manual" && policy.manualAccount && !sameAccount(policy.manualAccount, key)) {
      eligible = false;
      reasons.push("Manual routing targets another account");
    }

    // Score components normalized to [0, 1]
    const quotaScore = quota.remainingPct / 100;
    let healthScore = acc.authState === "authenticated" && !pageErr ? 1 : 0;
    if (quota.low) healthScore *= 0.65;
    if (acc.cookieSessionOnly) healthScore *= 0.9;
    const loadScore = Math.max(0, 1 - activeCount / Math.max(1, rule.maxConcurrent));
    const priorityScore = rule.priority / 100;

    const wSum =
      policy.weights.quota +
      policy.weights.health +
      policy.weights.load +
      policy.weights.priority || 1;
    const weighted =
      (quotaScore * policy.weights.quota +
        healthScore * policy.weights.health +
        loadScore * policy.weights.load +
        priorityScore * policy.weights.priority) /
      wSum;

    let score = weighted;
    if (strategy === "highest_quota") {
      score = quotaScore * 0.85 + loadScore * 0.1 + healthScore * 0.05;
    } else if (strategy === "least_busy") {
      const lastUsed = policy.lastAssignedMs[keyStr] ?? 0;
      const recencyPenalty = lastUsed > 0 ? Math.min(0.25, 0.25 / Math.max(1, (nowMs - lastUsed) / 60_000)) : 0;
      score = loadScore * 0.7 + (0.25 - recencyPenalty) + quotaScore * 0.05;
    } else if (strategy === "priority_based") {
      score = priorityScore * 0.8 + quotaScore * 0.1 + loadScore * 0.1;
    } else if (strategy === "manual") {
      score = sameAccount(policy.manualAccount, key) ? 1 : weighted * 0.5;
    }

    if (eligible) {
      reasons.push("Account health & session valid");
      reasons.push(`Active leases: ${activeCount}/${rule.maxConcurrent}`);
      reasons.push(
        quota.known ? `Available quota: ${quota.remainingPct}%` : "Quota metadata unverified (estimated 60%)"
      );
      reasons.push(`Routing score: ${(score * 100).toFixed(0)}/100 (priority ${rule.priority})`);
    }

    return {
      account: acc,
      eligible,
      reasons,
      score: Number(score.toFixed(4)),
      quotaScore: Number(quotaScore.toFixed(3)),
      healthScore: Number(healthScore.toFixed(3)),
      loadScore: Number(loadScore.toFixed(3)),
      priorityScore: Number(priorityScore.toFixed(3)),
      activeLeases: activeCount,
      maxConcurrent: rule.maxConcurrent,
      inCooldown,
      cooldownRemainingSecs,
      remainingQuotaPct: quota.remainingPct,
    };
  });

  const eligibleList = evals
    .filter((e) => e.eligible)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aLast = policy.lastAssignedMs[accountKeyStr({ providerId: a.account.providerId, uuid: a.account.uuid })] ?? 0;
      const bLast = policy.lastAssignedMs[accountKeyStr({ providerId: b.account.providerId, uuid: b.account.uuid })] ?? 0;
      return aLast - bLast;
    });

  const excluded = evals.filter((e) => !e.eligible);
  const selected = eligibleList[0] ?? null;
  const alternatives = eligibleList.slice(1);

  const reasoning: string[] = [];
  if (selected) {
    reasoning.push(`Strategy "${strategy}" selected "${selected.account.alias}" (score ${(selected.score * 100).toFixed(0)}/100).`);
    reasoning.push(...selected.reasons);
    if (alternatives.length > 0) {
      reasoning.push(
        `Fallback ready: ${alternatives.map((a) => `${a.account.alias} (${(a.score * 100).toFixed(0)}%)`).join(", ")}.`
      );
    }
  } else {
    reasoning.push(`No eligible accounts available for provider "${params.providerId}".`);
    if (excluded.length > 0) {
      reasoning.push(
        `Excluded: ${excluded.map((e) => `${e.account.alias} (${e.reasons[0] ?? "unavailable"})`).join("; ")}.`
      );
    }
  }

  return {
    providerId: params.providerId,
    strategy,
    selected,
    alternatives,
    excluded,
    reasoning,
  };
}

export interface AcquireLeaseParams extends EvaluateRoutingParams {
  holderType: "task_node" | "group_chat";
  holderId: string;
  holderLabel: string;
  leaseId: string;
  ttlMs?: number;
  pinnedAccount?: AccountKey | null;
}

export interface AcquireLeaseResult {
  ok: boolean;
  lease: AccountLease | null;
  selectedEval: RouterCandidateEval | null;
  nextLeases: AccountLease[];
  nextPolicy: RouterPolicyConfig;
  error?: string;
  preview: RoutingDecisionPreview;
}

export function acquireAccountLease(params: AcquireLeaseParams): AcquireLeaseResult {
  const nowMs = params.nowMs ?? Date.now();
  const cleanLeases = recoverExpiredLeases(params.leases, nowMs);
  const policy = normalizeRouterPolicy(params.policy);

  const evalParams: EvaluateRoutingParams = {
    ...params,
    leases: cleanLeases,
    policy: params.pinnedAccount
      ? { ...policy, strategy: "manual", manualAccount: params.pinnedAccount }
      : policy,
    strategyOverride: params.pinnedAccount ? "manual" : params.strategyOverride,
    nowMs,
  };

  const preview = previewRoutingDecision(evalParams);
  if (!preview.selected) {
    return {
      ok: false,
      lease: null,
      selectedEval: null,
      nextLeases: cleanLeases,
      nextPolicy: policy,
      error: preview.reasoning.join(" "),
      preview,
    };
  }

  const acc = preview.selected.account;
  const key: AccountKey = { providerId: acc.providerId, uuid: acc.uuid };
  const lease: AccountLease = {
    id: params.leaseId,
    account: key,
    holderType: params.holderType,
    holderId: params.holderId,
    holderLabel: params.holderLabel,
    acquiredAtMs: nowMs,
    expiresAtMs: nowMs + (params.ttlMs ?? DEFAULT_LEASE_TTL_MS),
  };

  const nextPolicy: RouterPolicyConfig = {
    ...policy,
    lastAssignedMs: {
      ...policy.lastAssignedMs,
      [accountKeyStr(key)]: nowMs,
    },
  };

  return {
    ok: true,
    lease,
    selectedEval: preview.selected,
    nextLeases: [...cleanLeases, lease],
    nextPolicy,
    preview,
  };
}

export function releaseAccountLease(
  leases: AccountLease[],
  leaseId: string,
  nowMs = Date.now()
): AccountLease[] {
  return recoverExpiredLeases(leases, nowMs).filter((l) => l.id !== leaseId);
}

export function markAccountCooldown(
  policy: RouterPolicyConfig,
  account: AccountKey,
  nowMs = Date.now(),
  overrideSecs?: number
): RouterPolicyConfig {
  const normalized = normalizeRouterPolicy(policy);
  const secs = overrideSecs ?? normalized.cooldownSecs;
  if (secs <= 0) return normalized;
  return {
    ...normalized,
    cooldownsUntilMs: {
      ...normalized.cooldownsUntilMs,
      [accountKeyStr(account)]: nowMs + secs * 1000,
    },
  };
}
