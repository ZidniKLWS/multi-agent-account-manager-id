import test from "node:test";
import assert from "node:assert/strict";
import type { AccountLease, AccountRecord, RouterPolicyConfig } from "../types";
import {
  acquireAccountLease,
  defaultRouterPolicy,
  markAccountCooldown,
  previewRoutingDecision,
  recoverExpiredLeases,
  releaseAccountLease,
} from "./smart-router";

function makeAccount(overrides: Partial<AccountRecord>): AccountRecord {
  return {
    providerId: "muse",
    uuid: "acc-1",
    alias: "Account 1",
    createdAtMs: 1000,
    autoAlias: false,
    proxyUrl: null,
    timezone: null,
    avatarUrl: null,
    quotaText: "80% · Normal",
    quotaPercent: 80,
    quotaDetail: {
      planLabel: "5h quota",
      planValue: "80% left",
      planSubtext: "Resets in 2h",
      planUsedPercent: 20,
      extraLabel: null,
      extraValue: null,
      extraSubtext: null,
      extraUsedPercent: null,
    },
    authState: "authenticated",
    cookieExpiresAtMs: 9_999_999_999_000,
    cookieSessionOnly: false,
    ...overrides,
  };
}

test("Smart Router filters logged out, depleted, cooldown, and excluded accounts", () => {
  const now = 1_000_000;
  const accounts: AccountRecord[] = [
    makeAccount({ uuid: "logged-out", alias: "SignedOut", authState: "logged_out" }),
    makeAccount({
      uuid: "depleted",
      alias: "Depleted",
      quotaText: "Exhausted",
      quotaPercent: 0,
      quotaDetail: {
        planLabel: "5h quota",
        planValue: "0% left",
        planSubtext: null,
        planUsedPercent: 100,
        extraLabel: null,
        extraValue: null,
        extraSubtext: null,
        extraUsedPercent: null,
      },
    }),
    makeAccount({ uuid: "cooldown", alias: "CooldownAcc" }),
    makeAccount({ uuid: "healthy", alias: "HealthyAcc" }),
  ];

  let policy: RouterPolicyConfig = defaultRouterPolicy();
  policy = markAccountCooldown(policy, { providerId: "muse", uuid: "cooldown" }, now, 60);

  const preview = previewRoutingDecision({
    accounts,
    policy,
    leases: [],
    providerId: "muse",
    nowMs: now,
  });

  assert.equal(preview.selected?.account.uuid, "healthy");
  assert.equal(preview.excluded.length, 3);
  assert.ok(preview.excluded.some((e) => e.account.uuid === "logged-out"));
  assert.ok(preview.excluded.some((e) => e.account.uuid === "depleted"));
  assert.ok(preview.excluded.some((e) => e.account.uuid === "cooldown" && e.inCooldown));
});

test("Concurrency reservation prevents two tasks from acquiring same maxConcurrent=1 account simultaneously", () => {
  const now = 2_000_000;
  const accounts: AccountRecord[] = [
    makeAccount({ uuid: "acc-a", alias: "Muse A" }),
    makeAccount({ uuid: "acc-b", alias: "Muse B", quotaDetail: {
      planLabel: "5h",
      planValue: "60% left",
      planSubtext: null,
      planUsedPercent: 40,
      extraLabel: null,
      extraValue: null,
      extraSubtext: null,
      extraUsedPercent: null,
    } }),
  ];
  const policy = defaultRouterPolicy();

  const first = acquireAccountLease({
    accounts,
    policy,
    leases: [],
    providerId: "muse",
    holderType: "task_node",
    holderId: "task-1:step-1",
    holderLabel: "Task 1",
    leaseId: "lease-1",
    nowMs: now,
  });
  assert.equal(first.ok, true);
  assert.equal(first.lease?.account.uuid, "acc-a");
  assert.equal(first.nextLeases.length, 1);

  const second = acquireAccountLease({
    accounts,
    policy: first.nextPolicy,
    leases: first.nextLeases,
    providerId: "muse",
    holderType: "task_node",
    holderId: "task-2:step-1",
    holderLabel: "Task 2",
    leaseId: "lease-2",
    nowMs: now + 100,
  });
  assert.equal(second.ok, true);
  assert.equal(second.lease?.account.uuid, "acc-b");
  assert.equal(second.nextLeases.length, 2);

  // Third concurrent request has no free accounts left
  const third = acquireAccountLease({
    accounts,
    policy: second.nextPolicy,
    leases: second.nextLeases,
    providerId: "muse",
    holderType: "group_chat",
    holderId: "grp-1",
    holderLabel: "Group 1",
    leaseId: "lease-3",
    nowMs: now + 200,
  });
  assert.equal(third.ok, false);
  assert.equal(third.lease, null);

  // Releasing lease-1 makes acc-a available again
  const afterRelease = releaseAccountLease(second.nextLeases, "lease-1", now + 300);
  assert.equal(afterRelease.length, 1);

  const fourth = acquireAccountLease({
    accounts,
    policy: second.nextPolicy,
    leases: afterRelease,
    providerId: "muse",
    holderType: "group_chat",
    holderId: "grp-1",
    holderLabel: "Group 1",
    leaseId: "lease-4",
    nowMs: now + 400,
  });
  assert.equal(fourth.ok, true);
  assert.equal(fourth.lease?.account.uuid, "acc-a");
});

test("Expired leases recover automatically after abnormal termination", () => {
  const leases: AccountLease[] = [
    {
      id: "stale",
      account: { providerId: "muse", uuid: "acc-1" },
      holderType: "task_node",
      holderId: "t1",
      holderLabel: "Stale",
      acquiredAtMs: 1000,
      expiresAtMs: 5000,
    },
    {
      id: "fresh",
      account: { providerId: "muse", uuid: "acc-2" },
      holderType: "task_node",
      holderId: "t2",
      holderLabel: "Fresh",
      acquiredAtMs: 4000,
      expiresAtMs: 25000,
    },
  ];
  const recovered = recoverExpiredLeases(leases, 10000);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].id, "fresh");
});

test("Priority-based and minQuotaPercent rules honor configuration", () => {
  const now = 3_000_000;
  const accounts: AccountRecord[] = [
    makeAccount({
      uuid: "low-q",
      alias: "LowQuota",
      quotaDetail: {
        planLabel: "5h",
        planValue: "8% left",
        planSubtext: null,
        planUsedPercent: 92,
        extraLabel: null,
        extraValue: null,
        extraSubtext: null,
        extraUsedPercent: null,
      },
    }),
    makeAccount({
      uuid: "mid-q",
      alias: "MidQuotaHighPrio",
      quotaDetail: {
        planLabel: "5h",
        planValue: "50% left",
        planSubtext: null,
        planUsedPercent: 50,
        extraLabel: null,
        extraValue: null,
        extraSubtext: null,
        extraUsedPercent: null,
      },
    }),
    makeAccount({
      uuid: "high-q",
      alias: "HighQuotaLowPrio",
      quotaDetail: {
        planLabel: "5h",
        planValue: "95% left",
        planSubtext: null,
        planUsedPercent: 5,
        extraLabel: null,
        extraValue: null,
        extraSubtext: null,
        extraUsedPercent: null,
      },
    }),
  ];

  const policy: RouterPolicyConfig = {
    ...defaultRouterPolicy(),
    strategy: "priority_based",
    minQuotaPercent: 15,
    accountRules: [
      {
        account: { providerId: "muse", uuid: "mid-q" },
        priority: 95,
        maxConcurrent: 1,
        allowed: true,
        allowedAgentIds: [],
      },
      {
        account: { providerId: "muse", uuid: "high-q" },
        priority: 20,
        maxConcurrent: 1,
        allowed: true,
        allowedAgentIds: [],
      },
    ],
  };

  const preview = previewRoutingDecision({
    accounts,
    policy,
    leases: [],
    providerId: "muse",
    nowMs: now,
  });

  assert.equal(preview.selected?.account.uuid, "mid-q");
  assert.ok(preview.excluded.some((e) => e.account.uuid === "low-q"));
});
