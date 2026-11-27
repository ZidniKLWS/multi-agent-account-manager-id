import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficeGrid,
  COFFEE_SPOT,
  createOfficeSimulation,
  deriveAgentVisualAssignments,
  DESK_SLOTS,
  findOfficePath,
  stepOfficeSimulation,
  syncSimulationWithSnapshot,
  triggerCoffeeBreakForIdleAgents,
} from "./virtual-office";
import type { ManagerSnapshot } from "../types";

function makeMinimalSnapshot(): ManagerSnapshot {
  return {
    providers: [
      { id: "muse", name: "Muse", shortName: "Muse", enabled: true, url: "https://example.com" },
    ],
    activeProviderId: "muse",
    accounts: [
      {
        providerId: "muse",
        uuid: "u1",
        alias: "muse.demo@example.com",
        createdAtMs: 1,
        autoAlias: false,
        proxyUrl: null,
        timezone: null,
        avatarUrl: null,
        quotaText: null,
        quotaPercent: 80,
        quotaDetail: null,
        authState: "authenticated",
        cookieExpiresAtMs: null,
        cookieSessionOnly: false,
      },
    ],
    groupChats: [],
    activeGroupId: null,
    externalAgents: [],
    agents: [
      {
        id: "ag_res",
        name: "Researcher",
        role: "Research Specialist",
        description: "",
        instructions: "",
        capabilities: ["research"],
        outputFormat: "Markdown",
        enabled: true,
        reviewRequired: false,
        resourcePolicy: {
          targetType: "smart_router",
          providerId: "muse",
          routingMode: "smart_balanced",
          pinnedAccount: null,
          externalAgentId: null,
          accountPool: [],
          maxConcurrentTasks: 1,
        },
        stats: { runs: 3, successes: 3, failures: 0, avgLatencyMs: 600 },
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        id: "ag_rev",
        name: "Reviewer",
        role: "Quality Reviewer",
        description: "",
        instructions: "",
        capabilities: ["review"],
        outputFormat: "Markdown",
        enabled: false,
        reviewRequired: false,
        resourcePolicy: {
          targetType: "smart_router",
          providerId: "muse",
          routingMode: "smart_balanced",
          pinnedAccount: null,
          externalAgentId: null,
          accountPool: [],
          maxConcurrentTasks: 1,
        },
        stats: { runs: 0, successes: 0, failures: 0, avgLatencyMs: 0 },
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ],
    workflows: [],
    tasks: [
      {
        id: "task_1",
        title: "Test Task",
        objective: "Check",
        context: "",
        outputFormat: "Markdown",
        workflowId: "wf_1",
        workflowName: "Standard",
        routingStrategy: "smart_balanced",
        status: "running",
        currentStepIndex: 1,
        pauseRequested: false,
        nodeExecutions: [
          {
            stepId: "s1",
            title: "Gather Research",
            kind: "agent",
            agentId: "ag_res",
            agentName: "Researcher",
            status: "running",
            attempt: 1,
            allocatedResourceLabel: "muse.demo@example.com",
            summary: "",
            startedAtMs: 100,
            completedAtMs: null,
          },
        ],
        artifacts: [],
        events: [],
        createdAtMs: 100,
        startedAtMs: 100,
        completedAtMs: null,
      },
    ],
    activeTaskId: "task_1",
    accountLeases: [
      {
        id: "lease_1",
        account: { providerId: "muse", uuid: "u1" },
        holderType: "task_node",
        holderId: "task_1:ag_res",
        holderLabel: "Researcher",
        acquiredAtMs: 100,
        expiresAtMs: 999999999,
      },
    ],
    autoApprove: true,
    isolateSameProxyKeepAlive: false,
    silentSyncIntervalMins: 5,
    minimizeToTray: false,
    globalShortcut: "",
    shortcutStatus: "",
    shortcutError: null,
    lanSyncActive: false,
    notices: [],
    language: "en",
  } as unknown as ManagerSnapshot;
}

test("A* finds valid unobstructed path from desk chair to coffee machine", () => {
  const grid = buildOfficeGrid();
  const path = findOfficePath(grid, DESK_SLOTS[0].chairPos, COFFEE_SPOT);
  assert.ok(path.length > 5);
  const last = path[path.length - 1];
  assert.deepEqual(last, COFFEE_SPOT);
});

test("derives typing, lease chip, paper stacks, and disabled sleeping states from live snapshot", () => {
  const snap = makeMinimalSnapshot();
  const assignments = deriveAgentVisualAssignments(snap);
  assert.equal(assignments.length, 2);
  assert.equal(assignments[0].desiredActivity, "typing");
  assert.equal(assignments[0].paperStacks, 3);
  assert.equal(assignments[0].leaseLabel, "muse:muse.demo@example.com");
  assert.equal(assignments[1].desiredActivity, "sleeping");
});

test("simulation walks idle agent to coffee machine and back with coffee cup", () => {
  const snap = makeMinimalSnapshot();
  if (snap.tasks && snap.tasks[0]) {
    snap.tasks[0].status = "completed";
    snap.tasks[0].nodeExecutions[0].status = "completed";
  }
  const sim = createOfficeSimulation(snap);
  syncSimulationWithSnapshot(sim, snap);
  assert.equal(sim.agents[0].desiredActivity, "idle");

  const triggered = triggerCoffeeBreakForIdleAgents(sim);
  assert.equal(triggered, 1);
  assert.equal(sim.agents[0].activity, "fetching_coffee");

  for (let i = 0; i < 300; i += 1) {
    stepOfficeSimulation(sim, 0.05);
  }
  assert.equal(sim.agents[0].hasCoffee, true);
});
