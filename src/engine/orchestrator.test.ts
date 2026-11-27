import test from "node:test";
import assert from "node:assert/strict";
import type { OrchestratedTask, WorkflowPipeline } from "../types";
import {
  buildStepPrompt,
  createDefaultAgents,
  createDefaultWorkflows,
  evaluateStepCondition,
  recoverInterruptedTasks,
  validateWorkflowPipeline,
} from "./orchestrator";

test("Default workflows validate cleanly against default agents", () => {
  const agents = createDefaultAgents(1000);
  const workflows = createDefaultWorkflows(1000);
  for (const wf of workflows) {
    const res = validateWorkflowPipeline(wf, agents);
    assert.equal(res.valid, true, `Workflow ${wf.name} should be valid: ${res.errors.join(", ")}`);
  }
});

test("Workflow validator rejects empty steps, missing agents, and unbounded retries", () => {
  const agents = createDefaultAgents(1000);
  const badPipeline: WorkflowPipeline = {
    id: "bad",
    name: "Bad",
    description: "",
    version: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
    steps: [
      {
        id: "s1",
        title: "Step 1",
        kind: "agent",
        agentId: "nonexistent",
        maxRetries: 99,
      },
    ],
  };
  const res = validateWorkflowPipeline(badPipeline, agents);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("maxRetries")));
  assert.ok(res.errors.some((e) => e.includes("missing agent")));
});

test("Prompt builder enforces context truncation budget across prior artifacts", () => {
  const agents = createDefaultAgents(1000);
  const researcher = agents[0];
  const prompt = buildStepPrompt({
    task: {
      title: "Market Brief",
      objective: "Analyze top 5 trends",
      context: "A".repeat(2000),
      outputFormat: "Markdown",
    },
    agent: researcher,
    step: { id: "s1", title: "Analyze", kind: "agent", agentId: researcher.id, maxRetries: 1 },
    priorArtifacts: [
      {
        id: "a1",
        stepId: "s0",
        title: "Raw Notes",
        agentName: "Researcher",
        format: "Text",
        content: "B".repeat(4000),
        createdAtMs: 100,
      },
    ],
    maxContextChars: 1200,
  });
  assert.ok(prompt.includes("[truncated"));
  assert.ok(prompt.length < 2200);
});

test("Condition evaluator verifies min_length and keyword checks", () => {
  const shortArt = [
    {
      id: "1",
      stepId: "s1",
      title: "Draft",
      agentName: "Writer",
      format: "MD",
      content: "Too short",
      createdAtMs: 1,
    },
  ];
  const failRes = evaluateStepCondition(
    {
      metric: "min_length",
      value: "50",
      onPassLabel: "Pass",
      onFailLabel: "Retry",
      actionOnFail: "retry_previous",
    },
    shortArt
  );
  assert.equal(failRes.passed, false);

  const kwRes = evaluateStepCondition(
    {
      metric: "contains_keyword",
      value: "risk",
      onPassLabel: "Pass",
      onFailLabel: "Retry",
      actionOnFail: "continue_with_warning",
    },
    [{ ...shortArt[0], content: "Key risk: single-IP rate limits." }]
  );
  assert.equal(kwRes.passed, true);
});

test("Interrupted tasks recover cleanly on app reload", () => {
  const tasks: OrchestratedTask[] = [
    {
      id: "t1",
      title: "Test",
      objective: "Obj",
      context: "",
      outputFormat: "MD",
      workflowId: "wf1",
      workflowName: "WF",
      routingStrategy: "smart_balanced",
      status: "running",
      currentStepIndex: 1,
      pauseRequested: false,
      cancelRequested: false,
      createdAtMs: 100,
      startedAtMs: 110,
      completedAtMs: null,
      nodeExecutions: [
        {
          stepId: "s1",
          title: "Step 1",
          kind: "agent",
          agentId: "a1",
          agentName: "Researcher",
          status: "running",
          attempt: 1,
          allocatedResourceLabel: "Muse",
          allocatedAccount: null,
          leaseId: "lease-x",
          startedAtMs: 110,
          completedAtMs: null,
          error: null,
          summary: null,
        },
      ],
      artifacts: [],
      events: [],
      error: null,
    },
  ];
  const recovered = recoverInterruptedTasks(tasks, 5000);
  assert.equal(recovered[0].status, "interrupted");
  assert.equal(recovered[0].nodeExecutions[0].status, "failed");
  assert.equal(recovered[0].nodeExecutions[0].leaseId, null);
});
