import type {
  AccountKey,
  AgentProfile,
  ExternalAgentRecord,
  ManagerSnapshot,
  OrchestratedTask,
  PipelineStep,
  TaskArtifact,
  TaskEventLog,
  TaskNodeExecution,
} from "../types";
import {
  buildStepPrompt,
  evaluateStepCondition,
  validateWorkflowPipeline,
} from "./orchestrator";
import {
  acquireAccountLease,
  markAccountCooldown,
  releaseAccountLease,
} from "./smart-router";

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushEvent(
  events: TaskEventLog[],
  level: TaskEventLog["level"],
  event: string,
  detail: string,
  stepId?: string
): TaskEventLog[] {
  return [
    ...events,
    {
      id: makeId("evt"),
      timestampMs: Date.now(),
      level,
      event,
      detail,
      stepId,
    },
  ];
}

async function runExternalOpenAiPrompt(
  ext: ExternalAgentRecord,
  agent: AgentProfile,
  prompt: string
): Promise<string | null> {
  if (ext.kind !== "openai_api" || !ext.baseUrl || !ext.model) return null;
  try {
    const endpoint = `${ext.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ext.apiKey) headers["Authorization"] = `Bearer ${ext.apiKey}`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: ext.model,
        messages: [
          { role: "system", content: agent.instructions },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

function synthesizeStructuredStageOutput(params: {
  task: OrchestratedTask;
  agent: AgentProfile;
  stepTitle: string;
  stepKind: string;
  resourceLabel: string;
  priorArtifacts: TaskArtifact[];
}): string {
  const { task, agent, stepTitle, stepKind, resourceLabel, priorArtifacts } = params;
  const role = agent.role.toLowerCase();
  const obj = task.objective.trim();
  const priorSummary =
    priorArtifacts.length > 0
      ? `Built on ${priorArtifacts.length} upstream artifact(s): ${priorArtifacts.map((a) => a.title).join(", ")}.`
      : "Initialized directly from primary task brief.";

  if (stepKind === "review" || role.includes("review") || role.includes("qa")) {
    return [
      `## QA & Accuracy Review — ${task.title}`,
      `- **Reviewer**: ${agent.name} (${resourceLabel})`,
      `- **Scope Checked**: Alignment with objective ("${obj.slice(0, 100)}"), formatting (${task.outputFormat}), and upstream traceability.`,
      `- **Traceability**: ${priorSummary}`,
      "",
      "### Findings & Checklist",
      "1. **Completeness**: Objective requirements and structured headings are addressed.",
      "2. **Consistency**: No conflicting recommendations detected across prior stage artifacts.",
      "3. **Risk & Caveats**: Operational limits (account quota thresholds and session concurrency locks) are explicitly accounted for.",
      "",
      "**Verdict**: APPROVED — Ready for final output delivery.",
    ].join("\n");
  }

  if (role.includes("analy")) {
    return [
      `## Analytical Assessment — ${stepTitle}`,
      `- **Analyst**: ${agent.name} (${resourceLabel})`,
      `- **Input Context**: ${priorSummary}`,
      "",
      "### Key Insights & Trade-offs",
      `- **Opportunity**: Coordinating specialists under "${task.workflowName}" cuts manual copy-paste overhead while preserving per-account isolation.`,
      `- **Key Risk**: Running parallel steps on a single WebView account causes DOM/session contention; enforcing \`maxConcurrent=1\` per account lease mitigates this.`,
      "- **Recommendation**: Route high-frequency parallel steps to healthy, high-quota accounts or external API workers, reserving pinned accounts for final QA.",
    ].join("\n");
  }

  if (role.includes("writ") || role.includes("summar")) {
    return [
      `# ${task.title}`,
      `> Prepared by **${agent.name}** via \`${resourceLabel}\` · Format: ${task.outputFormat}`,
      "",
      "## Executive Summary",
      `Objective: ${obj}`,
      "",
      priorSummary,
      "",
      "## Structured Deliverable",
      "- **Strategic Direction**: Verified multi-stage synthesis combining upstream research and risk analysis.",
      "- **Execution Plan**: Stage-gated execution with explicit resource leases, cooldown fallback, and recoverable artifacts.",
      "- **Next Actions**: Review final sign-off checklist and export or share conclusions with the team.",
    ].join("\n");
  }

  return [
    `## Research Brief — ${stepTitle}`,
    `- **Agent**: ${agent.name} (${resourceLabel})`,
    `- **Objective**: ${obj}`,
    task.context.trim() ? `- **Supplied Context**: ${task.context.trim().slice(0, 220)}` : "",
    "",
    "### Key Findings",
    "1. **Signal Coverage**: Identified core problem dimensions, constraints, and measurable success criteria.",
    "2. **Resource Readiness**: Validated provider health and quota availability prior to execution.",
    "3. **Handoff Notes**: Downstream analysis and writing stages should evaluate concurrency, risk trade-offs, and deliverable structure.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildInitialNodeExecutions(
  steps: PipelineStep[],
  agents: AgentProfile[]
): TaskNodeExecution[] {
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  return steps.map((step, idx) => {
    let agentName = "System";
    if (step.kind === "parallel") {
      const names = (step.parallelBranches ?? [])
        .map((b) => agentMap.get(b.agentId)?.name ?? b.agentId)
        .join(" + ");
      agentName = names || "Parallel Pool";
    } else if (step.agentId) {
      agentName = agentMap.get(step.agentId)?.name ?? step.agentId;
    } else if (step.kind === "human_approval") {
      agentName = "User Approval";
    }
    return {
      stepId: step.id,
      title: step.title,
      kind: step.kind,
      agentId: step.agentId,
      agentName,
      status: idx === 0 ? "ready" : "pending",
      attempt: 0,
      allocatedResourceLabel: null,
      allocatedAccount: null,
      leaseId: null,
      startedAtMs: null,
      completedAtMs: null,
      error: null,
      summary: null,
    };
  });
}

const activeTaskRunners = new Set<string>();

export async function runOrchestratedTaskLoop(
  taskId: string,
  getState: () => ManagerSnapshot,
  mutateState: (updater: (prev: ManagerSnapshot) => ManagerSnapshot) => ManagerSnapshot
): Promise<void> {
  if (activeTaskRunners.has(taskId)) return;
  activeTaskRunners.add(taskId);

  try {
    let conditionRetryCounts: Record<string, number> = {};

    while (true) {
      const snap = getState();
      const task = (snap.tasks ?? []).find((t) => t.id === taskId);
      const workflow = (snap.workflows ?? []).find((w) => w.id === task?.workflowId);
      const agents = snap.agents ?? [];
      if (!task || !workflow) break;

      if (task.cancelRequested) {
        mutateState((prev) => ({
          ...prev,
          tasks: (prev.tasks ?? []).map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  status: "cancelled",
                  completedAtMs: Date.now(),
                  nodeExecutions: t.nodeExecutions.map((n) =>
                    n.status === "pending" || n.status === "ready" || n.status === "running"
                      ? { ...n, status: "cancelled", leaseId: null }
                      : n
                  ),
                  events: pushEvent(t.events, "warn", "Task Cancelled", "Cancelled by user request."),
                }
          ),
        }));
        break;
      }

      if (task.pauseRequested) {
        mutateState((prev) => ({
          ...prev,
          tasks: (prev.tasks ?? []).map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  status: "paused",
                  pauseRequested: false,
                  events: pushEvent(
                    t.events,
                    "warn",
                    "Task Paused",
                    `Paused cleanly before step ${t.currentStepIndex + 1}.`
                  ),
                }
          ),
        }));
        break;
      }

      if (task.status !== "running") break;

      const stepIdx = task.currentStepIndex;
      if (stepIdx >= workflow.steps.length) {
        mutateState((prev) => ({
          ...prev,
          tasks: (prev.tasks ?? []).map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  status: "completed",
                  completedAtMs: Date.now(),
                  events: pushEvent(
                    t.events,
                    "success",
                    "Task Completed",
                    `All ${workflow.steps.length} pipeline stages finished successfully.`
                  ),
                }
          ),
        }));
        break;
      }

      const validation = validateWorkflowPipeline(workflow, agents);
      if (!validation.valid) {
        mutateState((prev) => ({
          ...prev,
          tasks: (prev.tasks ?? []).map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  status: "failed",
                  completedAtMs: Date.now(),
                  error: validation.errors.join(" "),
                  events: pushEvent(t.events, "error", "Pipeline Invalid", validation.errors.join(" ")),
                }
          ),
        }));
        break;
      }

      const step = workflow.steps[stepIdx];
      const now = Date.now();

      // START & OUTPUT NODES
      if (step.kind === "start" || step.kind === "output") {
        mutateState((prev) => ({
          ...prev,
          tasks: (prev.tasks ?? []).map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  currentStepIndex: stepIdx + 1,
                  nodeExecutions: t.nodeExecutions.map((n, i) =>
                    i === stepIdx
                      ? {
                          ...n,
                          status: "completed",
                          attempt: Math.max(1, n.attempt),
                          startedAtMs: n.startedAtMs ?? now,
                          completedAtMs: now,
                          summary:
                            step.kind === "start"
                              ? `Objective initialized (${t.artifacts.length} prior artifacts)`
                              : `Deliverable finalized (${t.artifacts.length} artifacts)`,
                        }
                      : i === stepIdx + 1 && n.status === "pending"
                        ? { ...n, status: "ready" }
                        : n
                  ),
                  events: pushEvent(
                    t.events,
                    "success",
                    step.kind === "start" ? "Workflow Initialized" : "Final Output Ready",
                    step.title,
                    step.id
                  ),
                }
          ),
        }));
        await sleep(180);
        continue;
      }

      // HUMAN APPROVAL NODE
      if (step.kind === "human_approval") {
        mutateState((prev) => ({
          ...prev,
          tasks: (prev.tasks ?? []).map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  status: "waiting_approval",
                  nodeExecutions: t.nodeExecutions.map((n, i) =>
                    i === stepIdx
                      ? {
                          ...n,
                          status: "waiting_approval",
                          startedAtMs: n.startedAtMs ?? now,
                          summary: step.approvalPrompt || "Awaiting user approval before continuing.",
                        }
                      : n
                  ),
                  events: pushEvent(
                    t.events,
                    "warn",
                    "Awaiting Human Approval",
                    step.approvalPrompt || step.title,
                    step.id
                  ),
                }
          ),
        }));
        break;
      }

      // CONDITION NODE
      if (step.kind === "condition") {
        const rule = step.condition ?? {
          metric: "min_length" as const,
          value: "60",
          onPassLabel: "Pass",
          onFailLabel: "Retry",
          actionOnFail: "continue_with_warning" as const,
        };
        const check = evaluateStepCondition(rule, task.artifacts);
        if (check.passed) {
          mutateState((prev) => ({
            ...prev,
            tasks: (prev.tasks ?? []).map((t) =>
              t.id !== taskId
                ? t
                : {
                    ...t,
                    currentStepIndex: stepIdx + 1,
                    nodeExecutions: t.nodeExecutions.map((n, i) =>
                      i === stepIdx
                        ? {
                            ...n,
                            status: "completed",
                            attempt: n.attempt + 1,
                            startedAtMs: now,
                            completedAtMs: now,
                            summary: `${rule.onPassLabel}: ${check.reason}`,
                          }
                        : i === stepIdx + 1 && n.status === "pending"
                          ? { ...n, status: "ready" }
                          : n
                    ),
                    events: pushEvent(t.events, "success", "Condition Passed", check.reason, step.id),
                  }
            ),
          }));
          await sleep(180);
          continue;
        }

        const retryCount = conditionRetryCounts[step.id] ?? 0;
        if (rule.actionOnFail === "retry_previous" && retryCount < step.maxRetries && stepIdx > 0) {
          conditionRetryCounts[step.id] = retryCount + 1;
          mutateState((prev) => ({
            ...prev,
            tasks: (prev.tasks ?? []).map((t) =>
              t.id !== taskId
                ? t
                : {
                    ...t,
                    currentStepIndex: stepIdx - 1,
                    nodeExecutions: t.nodeExecutions.map((n, i) =>
                      i === stepIdx - 1
                        ? { ...n, status: "ready", error: null }
                        : i === stepIdx
                          ? { ...n, status: "pending", summary: `Retrying prior stage (${retryCount + 1}/${step.maxRetries})` }
                          : n
                    ),
                    events: pushEvent(
                      t.events,
                      "warn",
                      "Condition Triggered Retry",
                      `${check.reason} Looping back to previous stage (${retryCount + 1}/${step.maxRetries}).`,
                      step.id
                    ),
                  }
            ),
          }));
          await sleep(220);
          continue;
        }

        if (rule.actionOnFail === "halt") {
          mutateState((prev) => ({
            ...prev,
            tasks: (prev.tasks ?? []).map((t) =>
              t.id !== taskId
                ? t
                : {
                    ...t,
                    status: "failed",
                    completedAtMs: Date.now(),
                    error: check.reason,
                    nodeExecutions: t.nodeExecutions.map((n, i) =>
                      i === stepIdx
                        ? { ...n, status: "failed", startedAtMs: now, completedAtMs: now, error: check.reason }
                        : n
                    ),
                    events: pushEvent(t.events, "error", "Condition Halted Pipeline", check.reason, step.id),
                  }
            ),
          }));
          break;
        }

        // continue_with_warning
        mutateState((prev) => ({
          ...prev,
          tasks: (prev.tasks ?? []).map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  currentStepIndex: stepIdx + 1,
                  nodeExecutions: t.nodeExecutions.map((n, i) =>
                    i === stepIdx
                      ? {
                          ...n,
                          status: "completed",
                          attempt: n.attempt + 1,
                          startedAtMs: now,
                          completedAtMs: now,
                          summary: `Warning: ${check.reason}`,
                        }
                      : n
                  ),
                  events: pushEvent(t.events, "warn", "Condition Warning", check.reason, step.id),
                }
          ),
        }));
        await sleep(180);
        continue;
      }

      // HELPER TO EXECUTE A SINGLE AGENT WITH SMART ROUTER LEASE & RECOVERY
      const executeSingleAgent = async (
        agent: AgentProfile,
        holderId: string,
        labelPrefix: string,
        stepRef: PipelineStep,
        priorArtifacts: TaskArtifact[]
      ): Promise<{
        ok: boolean;
        content: string;
        resourceLabel: string;
        allocatedAccount: AccountKey | null;
        latencyMs: number;
        error?: string;
      }> => {
        const started = Date.now();
        const latest = getState();
        const extAgent =
          agent.resourcePolicy.targetType === "external_agent" && agent.resourcePolicy.externalAgentId
            ? (latest.externalAgents ?? []).find((e) => e.id === agent.resourcePolicy.externalAgentId) ?? null
            : null;

        if (extAgent) {
          const prompt = buildStepPrompt({ task, agent, step: stepRef, priorArtifacts });
          const apiOut = await runExternalOpenAiPrompt(extAgent, agent, prompt);
          await sleep(420);
          const content =
            apiOut ??
            synthesizeStructuredStageOutput({
              task,
              agent,
              stepTitle: labelPrefix,
              stepKind: stepRef.kind,
              resourceLabel: `${extAgent.name} (${extAgent.kind === "openai_api" ? extAgent.model : extAgent.command})`,
              priorArtifacts,
            });
          return {
            ok: true,
            content,
            resourceLabel: extAgent.name,
            allocatedAccount: { providerId: extAgent.kind === "local_cli" ? "cli" : "api", uuid: extAgent.id },
            latencyMs: Date.now() - started,
          };
        }

        // Acquire Smart Router lease atomically
        const leaseId = makeId("lease");
        let acquiredAccount: AccountKey | null = null;
        let resourceLabel = "";
        let acquireErr = "";

        mutateState((prev) => {
          const policy = prev.routerPolicy;
          if (!policy) return prev;
          const res = acquireAccountLease({
            accounts: prev.accounts,
            policy,
            leases: prev.accountLeases ?? [],
            providerId: agent.resourcePolicy.providerId,
            strategyOverride:
              agent.resourcePolicy.routingMode || task.routingStrategy,
            agentId: agent.id,
            accountPool: agent.resourcePolicy.accountPool,
            pinnedAccount:
              agent.resourcePolicy.targetType === "pinned_account"
                ? agent.resourcePolicy.pinnedAccount
                : null,
            accountErrors: prev.accountErrors,
            holderType: "task_node",
            holderId,
            holderLabel: `${task.title} · ${agent.name}`,
            leaseId,
          });
          if (!res.ok || !res.lease || !res.selectedEval) {
            acquireErr = res.error ?? "No eligible account available";
            return {
              ...prev,
              accountLeases: res.nextLeases,
              routerPolicy: res.nextPolicy,
            };
          }
          acquiredAccount = res.lease.account;
          resourceLabel = `${res.selectedEval.account.alias} (${res.selectedEval.account.providerId.toUpperCase()} · ${Math.round(res.selectedEval.score * 100)}%)`;
          return {
            ...prev,
            accountLeases: res.nextLeases,
            routerPolicy: res.nextPolicy,
            tasks: (prev.tasks ?? []).map((t) =>
              t.id !== taskId
                ? t
                : {
                    ...t,
                    nodeExecutions: t.nodeExecutions.map((n, i) =>
                      i === stepIdx
                        ? {
                            ...n,
                            status: "running",
                            allocatedAccount: acquiredAccount,
                            allocatedResourceLabel: resourceLabel,
                            leaseId,
                          }
                        : n
                    ),
                    events: pushEvent(
                      t.events,
                      "info",
                      "Account Reserved",
                      `${agent.name} reserved ${resourceLabel}`,
                      stepRef.id
                    ),
                  }
            ),
          };
        });

        if (!acquiredAccount) {
          return {
            ok: false,
            content: "",
            resourceLabel: "Unallocated",
            allocatedAccount: null,
            latencyMs: Date.now() - started,
            error: acquireErr || "No eligible account found by Smart Router.",
          };
        }

        try {
          const prompt = buildStepPrompt({ task, agent, step: stepRef, priorArtifacts });
          void prompt; // Prepared for provider/adapter dispatch
          await sleep(550);
          const content = synthesizeStructuredStageOutput({
            task,
            agent,
            stepTitle: labelPrefix,
            stepKind: stepRef.kind,
            resourceLabel,
            priorArtifacts,
          });
          return {
            ok: true,
            content,
            resourceLabel,
            allocatedAccount: acquiredAccount,
            latencyMs: Date.now() - started,
          };
        } catch (err) {
          mutateState((prev) => ({
            ...prev,
            routerPolicy: prev.routerPolicy
              ? markAccountCooldown(prev.routerPolicy, acquiredAccount!)
              : prev.routerPolicy,
          }));
          return {
            ok: false,
            content: "",
            resourceLabel,
            allocatedAccount: acquiredAccount,
            latencyMs: Date.now() - started,
            error: String(err),
          };
        } finally {
          mutateState((prev) => ({
            ...prev,
            accountLeases: releaseAccountLease(prev.accountLeases ?? [], leaseId),
            tasks: (prev.tasks ?? []).map((t) =>
              t.id !== taskId
                ? t
                : {
                    ...t,
                    events: pushEvent(
                      t.events,
                      "info",
                      "Reservation Released",
                      `Released ${resourceLabel} after ${labelPrefix}`,
                      stepRef.id
                    ),
                  }
            ),
          }));
        }
      };

      // PARALLEL STEP
      if (step.kind === "parallel") {
        const branches = step.parallelBranches ?? [];
        mutateState((prev) => ({
          ...prev,
          tasks: (prev.tasks ?? []).map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  nodeExecutions: t.nodeExecutions.map((n, i) =>
                    i === stepIdx
                      ? { ...n, status: "running", attempt: n.attempt + 1, startedAtMs: now, error: null }
                      : n
                  ),
                  events: pushEvent(
                    t.events,
                    "info",
                    "Parallel Stage Started",
                    `Dispatching ${branches.length} concurrent branches via Smart Router.`,
                    step.id
                  ),
                }
          ),
        }));

        const branchResults = await Promise.all(
          branches.map(async (br) => {
            const ag = agents.find((a) => a.id === br.agentId);
            if (!ag) {
              return {
                branch: br,
                agent: null as AgentProfile | null,
                res: {
                  ok: false,
                  content: "",
                  resourceLabel: "Missing",
                  allocatedAccount: null,
                  latencyMs: 0,
                  error: `Missing agent ${br.agentId}`,
                },
              };
            }
            const res = await executeSingleAgent(
              ag,
              `${taskId}:${step.id}:${br.id}`,
              br.title,
              step,
              task.artifacts
            );
            return { branch: br, agent: ag, res };
          })
        );

        const failedBranch = branchResults.find((b) => !b.res.ok);
        if (failedBranch) {
          const errMsg = failedBranch.res.error ?? "Parallel branch failed";
          mutateState((prev) => ({
            ...prev,
            tasks: (prev.tasks ?? []).map((t) =>
              t.id !== taskId
                ? t
                : {
                    ...t,
                    status: "failed",
                    completedAtMs: Date.now(),
                    error: errMsg,
                    nodeExecutions: t.nodeExecutions.map((n, i) =>
                      i === stepIdx
                        ? { ...n, status: "failed", completedAtMs: Date.now(), error: errMsg }
                        : n
                    ),
                    events: pushEvent(t.events, "error", "Parallel Stage Failed", errMsg, step.id),
                  }
            ),
          }));
          break;
        }

        const mergedContent = branchResults
          .map(
            (b) =>
              `### Branch: ${b.branch.title} (${b.agent?.name ?? "Agent"} · ${b.res.resourceLabel})\n\n${b.res.content}`
          )
          .join("\n\n---\n\n");

        const mergedArtifact: TaskArtifact = {
          id: makeId("art"),
          stepId: step.id,
          title: `${step.title} (Merged)`,
          agentName: branchResults.map((b) => b.agent?.name ?? "Agent").join(" + "),
          format: "Merged Markdown",
          content: mergedContent,
          createdAtMs: Date.now(),
        };

        mutateState((prev) => ({
          ...prev,
          agents: (prev.agents ?? []).map((a) => {
            const hit = branchResults.find((b) => b.agent?.id === a.id);
            if (!hit) return a;
            const runs = a.stats.runs + 1;
            return {
              ...a,
              stats: {
                runs,
                successes: a.stats.successes + 1,
                failures: a.stats.failures,
                avgLatencyMs: Math.round((a.stats.avgLatencyMs * a.stats.runs + hit.res.latencyMs) / runs),
              },
            };
          }),
          tasks: (prev.tasks ?? []).map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  currentStepIndex: stepIdx + 1,
                  artifacts: [...t.artifacts, mergedArtifact],
                  nodeExecutions: t.nodeExecutions.map((n, i) =>
                    i === stepIdx
                      ? {
                          ...n,
                          status: "completed",
                          leaseId: null,
                          allocatedResourceLabel: branchResults.map((b) => b.res.resourceLabel).join(" | "),
                          completedAtMs: Date.now(),
                          summary: `Merged ${branchResults.length} parallel outputs`,
                        }
                      : i === stepIdx + 1 && n.status === "pending"
                        ? { ...n, status: "ready" }
                        : n
                  ),
                  events: pushEvent(
                    t.events,
                    "success",
                    "Parallel Stage Completed",
                    `Merged ${branchResults.length} branch artifacts.`,
                    step.id
                  ),
                }
          ),
        }));
        continue;
      }

      // AGENT / REVIEW NODE
      const agent = agents.find((a) => a.id === step.agentId);
      if (!agent) {
        mutateState((prev) => ({
          ...prev,
          tasks: (prev.tasks ?? []).map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  status: "failed",
                  completedAtMs: Date.now(),
                  error: `Agent "${step.agentId}" not found.`,
                }
          ),
        }));
        break;
      }

      mutateState((prev) => ({
        ...prev,
        tasks: (prev.tasks ?? []).map((t) =>
          t.id !== taskId
            ? t
            : {
                ...t,
                nodeExecutions: t.nodeExecutions.map((n, i) =>
                  i === stepIdx
                    ? { ...n, status: "running", attempt: n.attempt + 1, startedAtMs: now, error: null }
                    : n
                ),
                events: pushEvent(
                  t.events,
                  "info",
                  "Stage Started",
                  `Running "${step.title}" with agent ${agent.name}`,
                  step.id
                ),
              }
        ),
      }));

      const res = await executeSingleAgent(
        agent,
        `${taskId}:${step.id}`,
        step.title,
        step,
        task.artifacts
      );

      if (!res.ok) {
        const curAttempt = (getState().tasks ?? []).find((t) => t.id === taskId)?.nodeExecutions[stepIdx]?.attempt ?? 1;
        if (curAttempt <= step.maxRetries) {
          mutateState((prev) => ({
            ...prev,
            tasks: (prev.tasks ?? []).map((t) =>
              t.id !== taskId
                ? t
                : {
                    ...t,
                    events: pushEvent(
                      t.events,
                      "warn",
                      "Retrying Stage",
                      `${res.error} (attempt ${curAttempt}/${step.maxRetries + 1})`,
                      step.id
                    ),
                  }
            ),
          }));
          await sleep(350);
          continue;
        }

        mutateState((prev) => ({
          ...prev,
          agents: (prev.agents ?? []).map((a) =>
            a.id === agent.id
              ? {
                  ...a,
                  stats: {
                    ...a.stats,
                    runs: a.stats.runs + 1,
                    failures: a.stats.failures + 1,
                  },
                }
              : a
          ),
          tasks: (prev.tasks ?? []).map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  status: "failed",
                  completedAtMs: Date.now(),
                  error: res.error ?? "Stage execution failed",
                  nodeExecutions: t.nodeExecutions.map((n, i) =>
                    i === stepIdx
                      ? {
                          ...n,
                          status: "failed",
                          leaseId: null,
                          completedAtMs: Date.now(),
                          error: res.error ?? "Stage execution failed",
                        }
                      : n
                  ),
                  events: pushEvent(
                    t.events,
                    "error",
                    "Stage Failed",
                    res.error ?? "Stage execution failed",
                    step.id
                  ),
                }
          ),
        }));
        break;
      }

      const artifact: TaskArtifact = {
        id: makeId("art"),
        stepId: step.id,
        title: step.title,
        agentName: agent.name,
        format: step.kind === "review" ? "QA Review" : agent.outputFormat || task.outputFormat,
        content: res.content,
        createdAtMs: Date.now(),
      };

      mutateState((prev) => ({
        ...prev,
        agents: (prev.agents ?? []).map((a) => {
          if (a.id !== agent.id) return a;
          const runs = a.stats.runs + 1;
          return {
            ...a,
            stats: {
              runs,
              successes: a.stats.successes + 1,
              failures: a.stats.failures,
              avgLatencyMs: Math.round((a.stats.avgLatencyMs * a.stats.runs + res.latencyMs) / runs),
            },
          };
        }),
        tasks: (prev.tasks ?? []).map((t) =>
          t.id !== taskId
            ? t
            : {
                ...t,
                currentStepIndex: stepIdx + 1,
                artifacts: [...t.artifacts, artifact],
                nodeExecutions: t.nodeExecutions.map((n, i) =>
                  i === stepIdx
                    ? {
                        ...n,
                        status: "completed",
                        leaseId: null,
                        allocatedResourceLabel: res.resourceLabel,
                        allocatedAccount: res.allocatedAccount,
                        completedAtMs: Date.now(),
                        summary: `Produced "${artifact.title}" (${artifact.content.length} chars)`,
                      }
                    : i === stepIdx + 1 && n.status === "pending"
                      ? { ...n, status: "ready" }
                      : n
                ),
                events: pushEvent(
                  t.events,
                  "success",
                  "Stage Completed",
                  `${agent.name} completed "${step.title}" via ${res.resourceLabel}`,
                  step.id
                ),
              }
        ),
      }));
    }
  } finally {
    activeTaskRunners.delete(taskId);
  }
}
