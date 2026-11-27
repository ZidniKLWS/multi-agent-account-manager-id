import type {
  AgentProfile,
  OrchestratedTask,
  PipelineConditionRule,
  PipelineStep,
  TaskArtifact,
  WorkflowPipeline,
} from "../types";

export const MAX_ARTIFACT_CONTEXT_CHARS = 3200;

export type AgentTemplatePreset = {
  id: string;
  label: string;
  profile: Omit<AgentProfile, "id" | "createdAtMs" | "stats">;
};

export const AGENT_TEMPLATES: AgentTemplatePreset[] = [
  {
    id: "researcher",
    label: "Researcher",
    profile: {
      name: "Researcher",
      role: "Research Specialist",
      description: "Gathers facts, identifies patterns and sources, and builds a structured research brief.",
      enabled: true,
      instructions:
        "Gather key facts, examine market or technical signals, distinguish verified facts from assumptions, and deliver a concise, well-organized research brief.",
      capabilities: ["research", "summarization", "source-verification"],
      outputFormat: "Structured Research Brief",
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
    },
  },
  {
    id: "analyst",
    label: "Analyst",
    profile: {
      name: "Analyst",
      role: "Systems & Strategy Analyst",
      description: "Evaluates trade-offs, risks, opportunities, and patterns across collected findings.",
      enabled: true,
      instructions:
        "Analyze the prior brief for patterns, risks, opportunities, bottlenecks, and trade-offs. Produce concrete recommendations backed by reasoning.",
      capabilities: ["analysis", "risk-assessment", "comparison"],
      outputFormat: "Analytical Matrix & Insights",
      reviewRequired: false,
      resourcePolicy: {
        targetType: "smart_router",
        providerId: "hark",
        routingMode: "smart_balanced",
        pinnedAccount: null,
        externalAgentId: null,
        accountPool: [],
        maxConcurrentTasks: 1,
      },
    },
  },
  {
    id: "writer",
    label: "Writer",
    profile: {
      name: "Writer",
      role: "Editorial & Report Writer",
      description: "Transforms research and analysis into clear, structured deliverables.",
      enabled: true,
      instructions:
        "Synthesize all approved findings and insights into a polished, actionable final report following the requested output format.",
      capabilities: ["writing", "synthesis", "formatting"],
      outputFormat: "Executive Markdown Report",
      reviewRequired: true,
      resourcePolicy: {
        targetType: "smart_router",
        providerId: "muse",
        routingMode: "highest_quota",
        pinnedAccount: null,
        externalAgentId: null,
        accountPool: [],
        maxConcurrentTasks: 1,
      },
    },
  },
  {
    id: "reviewer",
    label: "Reviewer",
    profile: {
      name: "Reviewer",
      role: "Quality & Fact Reviewer",
      description: "Audits accuracy, completeness, contradictions, and formatting before final sign-off.",
      enabled: true,
      instructions:
        "Inspect the preceding draft for unsupported claims, logical gaps, missing objective items, and formatting flaws. List concrete corrections or approve if ready.",
      capabilities: ["qa", "fact-checking", "critique"],
      outputFormat: "QA Review & Final Sign-off",
      reviewRequired: false,
      resourcePolicy: {
        targetType: "smart_router",
        providerId: "hark",
        routingMode: "priority_based",
        pinnedAccount: null,
        externalAgentId: null,
        accountPool: [],
        maxConcurrentTasks: 1,
      },
    },
  },
  {
    id: "planner",
    label: "Planner",
    profile: {
      name: "Planner",
      role: "Execution Planner",
      description: "Breaks complex goals into actionable milestones, dependencies, and risk mitigations.",
      enabled: true,
      instructions:
        "Decompose the objective into clear phases, deliverables, resource requirements, and verification milestones.",
      capabilities: ["planning", "decomposition"],
      outputFormat: "Action Plan & Milestones",
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
    },
  },
  {
    id: "summarizer",
    label: "Summarizer",
    profile: {
      name: "Summarizer",
      role: "Context Synthesizer",
      description: "Compresses multi-source outputs into high-signal executive takeaways.",
      enabled: true,
      instructions:
        "Condense all inputs into key decisions, open questions, and bulleted next actions without losing critical numbers or caveats.",
      capabilities: ["summarization", "synthesis"],
      outputFormat: "Executive Summary",
      reviewRequired: false,
      resourcePolicy: {
        targetType: "smart_router",
        providerId: "muse",
        routingMode: "least_busy",
        pinnedAccount: null,
        externalAgentId: null,
        accountPool: [],
        maxConcurrentTasks: 1,
      },
    },
  },
  {
    id: "coding_assistant",
    label: "Coding Assistant",
    profile: {
      name: "Coding Assistant",
      role: "Implementation Engineer",
      description: "Designs schemas, code modules, edge-case guards, and verification checks.",
      enabled: true,
      instructions:
        "Propose clean, modular implementation steps, edge-case protections, and test cases grounded in the stated technical constraints.",
      capabilities: ["architecture", "coding", "testing"],
      outputFormat: "Technical Spec & Code Plan",
      reviewRequired: true,
      resourcePolicy: {
        targetType: "smart_router",
        providerId: "hark",
        routingMode: "smart_balanced",
        pinnedAccount: null,
        externalAgentId: null,
        accountPool: [],
        maxConcurrentTasks: 1,
      },
    },
  },
];

export function createDefaultAgents(nowMs = Date.now()): AgentProfile[] {
  return AGENT_TEMPLATES.slice(0, 4).map((tpl, idx) => ({
    ...tpl.profile,
    id: `agent_${tpl.id}`,
    stats: { runs: 0, successes: 0, failures: 0, avgLatencyMs: 0 },
    createdAtMs: nowMs + idx,
  }));
}

export function createDefaultWorkflows(nowMs = Date.now()): WorkflowPipeline[] {
  return [
    {
      id: "wf_research_pipeline",
      name: "Research → Analysis → Review",
      description: "Structured linear pipeline with quality check and final deliverable output.",
      version: 1,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      steps: [
        { id: "s_start", title: "Task Objective & Context", kind: "start", agentId: null, maxRetries: 0 },
        { id: "s_research", title: "Gather Research Brief", kind: "agent", agentId: "agent_researcher", maxRetries: 1 },
        { id: "s_analysis", title: "Analyze Risks & Insights", kind: "agent", agentId: "agent_analyst", maxRetries: 1 },
        { id: "s_write", title: "Draft Deliverable", kind: "agent", agentId: "agent_writer", maxRetries: 1 },
        { id: "s_review", title: "Quality Review", kind: "review", agentId: "agent_reviewer", maxRetries: 2 },
        { id: "s_output", title: "Final Reviewed Output", kind: "output", agentId: null, maxRetries: 0 },
      ],
    },
    {
      id: "wf_parallel_business",
      name: "Parallel Analysis + Synthesis",
      description: "Runs two specialist streams concurrently, checks output threshold, then merges & reviews.",
      version: 1,
      createdAtMs: nowMs + 1,
      updatedAtMs: nowMs + 1,
      steps: [
        { id: "p_start", title: "Business Prompt Intake", kind: "start", agentId: null, maxRetries: 0 },
        {
          id: "p_parallel",
          title: "Parallel Research & Risk Streams",
          kind: "parallel",
          agentId: null,
          maxRetries: 1,
          parallelBranches: [
            { id: "br_research", title: "Market & Signal Scan", agentId: "agent_researcher" },
            { id: "br_analyst", title: "Risk & Opportunity Scan", agentId: "agent_analyst" },
          ],
        },
        {
          id: "p_cond",
          title: "Findings Completeness Gate",
          kind: "condition",
          agentId: null,
          maxRetries: 1,
          condition: {
            metric: "min_length",
            value: "80",
            onPassLabel: "Proceed to Report",
            onFailLabel: "Retry Parallel Scan",
            actionOnFail: "retry_previous",
          },
        },
        { id: "p_write", title: "Synthesize Report", kind: "agent", agentId: "agent_writer", maxRetries: 1 },
        { id: "p_output", title: "Final Deliverable", kind: "output", agentId: null, maxRetries: 0 },
      ],
    },
    {
      id: "wf_approval_qc",
      name: "Quality Control (With Human Approval)",
      description: "Runs draft and automated QA review, then pauses for user sign-off before final output.",
      version: 1,
      createdAtMs: nowMs + 2,
      updatedAtMs: nowMs + 2,
      steps: [
        { id: "q_start", title: "Task Brief", kind: "start", agentId: null, maxRetries: 0 },
        { id: "q_write", title: "Produce Initial Draft", kind: "agent", agentId: "agent_writer", maxRetries: 1 },
        { id: "q_review", title: "Automated QA Check", kind: "review", agentId: "agent_reviewer", maxRetries: 2 },
        {
          id: "q_approve",
          title: "Human Approval Gate",
          kind: "human_approval",
          agentId: null,
          maxRetries: 0,
          approvalPrompt: "Review the QA feedback and draft artifact before publishing final output.",
        },
        { id: "q_output", title: "Approved Deliverable", kind: "output", agentId: null, maxRetries: 0 },
      ],
    },
  ];
}

export interface PipelineValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateWorkflowPipeline(
  pipeline: WorkflowPipeline,
  agents: AgentProfile[]
): PipelineValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!pipeline.name.trim()) {
    errors.push("Pipeline name cannot be empty.");
  }
  if (!Array.isArray(pipeline.steps) || pipeline.steps.length === 0) {
    errors.push("Pipeline must contain at least one step.");
    return { valid: false, errors, warnings };
  }

  const executableSteps = pipeline.steps.filter(
    (s) => s.kind === "agent" || s.kind === "review" || s.kind === "parallel"
  );
  if (executableSteps.length === 0) {
    errors.push("Pipeline must have at least one Agent, Review, or Parallel step.");
  }

  const agentMap = new Map(agents.map((a) => [a.id, a]));
  for (const step of pipeline.steps) {
    if (step.maxRetries < 0 || step.maxRetries > 5) {
      errors.push(`Step "${step.title}" must have bounded maxRetries between 0 and 5.`);
    }
    if (step.kind === "agent" || step.kind === "review") {
      if (!step.agentId) {
        errors.push(`Step "${step.title}" requires an assigned agent.`);
      } else {
        const ag = agentMap.get(step.agentId);
        if (!ag) {
          errors.push(`Step "${step.title}" references missing agent "${step.agentId}".`);
        } else if (!ag.enabled) {
          warnings.push(`Agent "${ag.name}" in step "${step.title}" is currently disabled.`);
        }
      }
    }
    if (step.kind === "parallel") {
      const branches = step.parallelBranches ?? [];
      if (branches.length < 2) {
        errors.push(`Parallel step "${step.title}" must include at least 2 branches.`);
      }
      for (const br of branches) {
        const ag = agentMap.get(br.agentId);
        if (!ag) {
          errors.push(`Parallel branch "${br.title}" references missing agent "${br.agentId}".`);
        } else if (!ag.enabled) {
          warnings.push(`Parallel branch "${br.title}" uses disabled agent "${ag.name}".`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function buildStepPrompt(params: {
  task: Pick<OrchestratedTask, "title" | "objective" | "context" | "outputFormat">;
  agent: AgentProfile;
  step: PipelineStep;
  priorArtifacts: TaskArtifact[];
  maxContextChars?: number;
}): string {
  const budget = params.maxContextChars ?? MAX_ARTIFACT_CONTEXT_CHARS;
  const lines: string[] = [
    `[Role: ${params.agent.name} — ${params.agent.role}]`,
    `Instructions: ${params.agent.instructions}`,
    "",
    `Task: ${params.task.title}`,
    `Objective: ${params.task.objective}`,
    `Current Stage: ${params.step.title} (${params.step.kind})`,
    `Desired Output Format: ${params.task.outputFormat || params.agent.outputFormat}`,
  ];

  if (params.task.context.trim()) {
    const ctx = params.task.context.trim().slice(0, Math.floor(budget * 0.45));
    lines.push("", `Task Context:\n${ctx}`);
  }

  if (params.priorArtifacts.length > 0) {
    const perArtifactBudget = Math.max(240, Math.floor((budget * 0.55) / params.priorArtifacts.length));
    lines.push("", "Prior Stage Artifacts:");
    for (const art of params.priorArtifacts) {
      const clipped =
        art.content.length > perArtifactBudget
          ? `${art.content.slice(0, perArtifactBudget)}\n...[truncated ${art.content.length - perArtifactBudget} chars]`
          : art.content;
      lines.push(`--- ${art.title} (${art.agentName}) ---\n${clipped}`);
    }
  }

  return lines.join("\n");
}

export function evaluateStepCondition(
  rule: PipelineConditionRule,
  priorArtifacts: TaskArtifact[]
): { passed: boolean; reason: string } {
  const latest = priorArtifacts[priorArtifacts.length - 1];
  const content = latest?.content ?? "";
  if (rule.metric === "min_length") {
    const threshold = Math.max(1, Number(rule.value) || 60);
    const passed = content.trim().length >= threshold;
    return {
      passed,
      reason: passed
        ? `Output length ${content.trim().length} meets minimum ${threshold} chars.`
        : `Output length ${content.trim().length} is below minimum ${threshold} chars.`,
    };
  }
  const needle = rule.value.trim().toLowerCase();
  if (rule.metric === "contains_keyword") {
    const passed = !needle || content.toLowerCase().includes(needle);
    return {
      passed,
      reason: passed
        ? `Output includes required keyword "${rule.value}".`
        : `Output does not include required keyword "${rule.value}".`,
    };
  }
  const hasForbidden = Boolean(needle) && content.toLowerCase().includes(needle);
  return {
    passed: !hasForbidden,
    reason: !hasForbidden
      ? `Output does not contain restricted term "${rule.value}".`
      : `Output contains restricted term "${rule.value}".`,
  };
}

export function recoverInterruptedTasks(tasks: OrchestratedTask[], nowMs = Date.now()): OrchestratedTask[] {
  return tasks.map((task) => {
    if (task.status !== "running" && task.status !== "pending") return task;
    return {
      ...task,
      status: "interrupted",
      error: "Execution interrupted by app reload or restart. You can retry the interrupted stage.",
      nodeExecutions: task.nodeExecutions.map((n) =>
        n.status === "running" || n.status === "ready"
          ? {
              ...n,
              status: "failed",
              leaseId: null,
              completedAtMs: nowMs,
              error: "Interrupted before completion",
            }
          : n
      ),
      events: [
        ...task.events,
        {
          id: `evt_recover_${nowMs}`,
          timestampMs: nowMs,
          level: "warn",
          event: "Interrupted Run Recovered",
          detail: "Active reservations cleared and running stages marked interrupted for safe retry.",
        },
      ],
    };
  });
}

export function formatTaskExportMarkdown(task: OrchestratedTask): string {
  const lines: string[] = [
    `# ${task.title}`,
    `- Status: ${task.status}`,
    `- Workflow: ${task.workflowName}`,
    `- Routing Strategy: ${task.routingStrategy}`,
    `- Objective: ${task.objective}`,
    "",
    "## Stage Timeline",
    ...task.nodeExecutions.map(
      (n, idx) =>
        `${idx + 1}. **${n.title}** (${n.agentName}) — \`${n.status}\`${n.allocatedResourceLabel ? ` via ${n.allocatedResourceLabel}` : ""}`
    ),
    "",
    "## Artifacts",
    ...task.artifacts.map((a) => `### ${a.title} (${a.agentName})\n\n${a.content}\n`),
  ];
  return lines.join("\n");
}
