import type {
  AccountKey,
  AgentExecutionTarget,
  AgentProfile,
  ManagerSnapshot,
  PipelineConditionRule,
  PipelineNodeKind,
  PipelineStep,
  ProviderInfo,
  RoutingStrategy,
  TaskStatus,
  WorkflowPipeline,
} from "../types";
import {
  AGENT_TEMPLATES,
  formatTaskExportMarkdown,
  validateWorkflowPipeline,
} from "../engine/orchestrator";
import { deriveAgentVisualAssignments } from "../engine/virtual-office";
import {
  mountOrUpdateVirtualOffice,
  sendIdleAgentsForCoffee,
} from "./virtual-office-canvas";

export interface AgentCenterViewDeps {
  callCmd: <T = ManagerSnapshot>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  applySnapshot: (snap: ManagerSnapshot) => void;
  rerender: () => void;
  escapeHtml: (value: string) => string;
  renderSharedChrome: (state: ManagerSnapshot, provider: ProviderInfo) => string;
}

type AgentCenterTab = "workspace" | "agents" | "workflows" | "history";

let activeTab: AgentCenterTab = "workspace";
let selectedArtifactId: string | null = null;
let selectedOfficeAgentId: string | null = null;
let officeShowLabels = true;
let officeExpanded = false;
let approvalCommentDraft = "";
let launcherExpanded = true;

let launchDraft = {
  title: "",
  objective: "",
  context: "",
  outputFormat: "Executive Markdown Report",
  workflowId: "",
  routingStrategy: "smart_balanced" as RoutingStrategy,
  error: "",
  launching: false,
};

let editingAgentId: string | null = null;
let agentForm = {
  name: "",
  role: "",
  description: "",
  instructions: "",
  capabilitiesText: "",
  outputFormat: "Structured Markdown",
  enabled: true,
  reviewRequired: false,
  targetType: "smart_router" as AgentExecutionTarget,
  providerId: "muse",
  routingMode: "smart_balanced" as RoutingStrategy,
  pinnedKey: "",
  externalAgentId: "",
  error: "",
  saving: false,
};

let editingWorkflowId: string | null = null;
let workflowDraft: WorkflowPipeline | null = null;
let workflowFormError = "";
let historySearch = "";
let historyStatusFilter: "all" | TaskStatus = "all";

function makeLocalId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().slice(0, 6)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "completed":
      return "ok";
    case "running":
    case "ready":
      return "running";
    case "waiting_approval":
    case "paused":
    case "interrupted":
      return "warn";
    case "failed":
    case "cancelled":
      return "danger";
    default:
      return "muted";
  }
}

function formatDurationMs(start: number | null, end: number | null): string {
  if (!start) return "—";
  const ms = Math.max(0, (end ?? Date.now()) - start);
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function loadWorkflowDraft(state: ManagerSnapshot): WorkflowPipeline | null {
  const workflows = state.workflows ?? [];
  if (workflowDraft && editingWorkflowId === workflowDraft.id) {
    return workflowDraft;
  }
  const target =
    (editingWorkflowId ? workflows.find((w) => w.id === editingWorkflowId) : null) ??
    workflows[0] ??
    null;
  if (!target) return null;
  editingWorkflowId = target.id;
  workflowDraft = JSON.parse(JSON.stringify(target)) as WorkflowPipeline;
  return workflowDraft;
}

function resetAgentForm(state: ManagerSnapshot, agent?: AgentProfile): void {
  if (!agent) {
    editingAgentId = null;
    agentForm = {
      name: "",
      role: "",
      description: "",
      instructions: "",
      capabilitiesText: "",
      outputFormat: "Structured Markdown",
      enabled: true,
      reviewRequired: false,
      targetType: "smart_router",
      providerId: state.providers.find((p) => p.enabled)?.id ?? "muse",
      routingMode: "smart_balanced",
      pinnedKey: "",
      externalAgentId: state.externalAgents[0]?.id ?? "",
      error: "",
      saving: false,
    };
    return;
  }
  editingAgentId = agent.id;
  agentForm = {
    name: agent.name,
    role: agent.role,
    description: agent.description,
    instructions: agent.instructions,
    capabilitiesText: agent.capabilities.join(", "),
    outputFormat: agent.outputFormat,
    enabled: agent.enabled,
    reviewRequired: agent.reviewRequired,
    targetType: agent.resourcePolicy.targetType,
    providerId: agent.resourcePolicy.providerId,
    routingMode: agent.resourcePolicy.routingMode,
    pinnedKey: agent.resourcePolicy.pinnedAccount
      ? `${agent.resourcePolicy.pinnedAccount.providerId}:${agent.resourcePolicy.pinnedAccount.uuid}`
      : "",
    externalAgentId: agent.resourcePolicy.externalAgentId ?? "",
    error: "",
    saving: false,
  };
}

export function renderAgentCenterMiddle(
  state: ManagerSnapshot,
  provider: ProviderInfo,
  deps: AgentCenterViewDeps
): string {
  const { escapeHtml, renderSharedChrome } = deps;
  const tasks = state.tasks ?? [];
  const agents = state.agents ?? [];
  const workflows = state.workflows ?? [];
  const activeTask =
    (state.activeTaskId ? tasks.find((t) => t.id === state.activeTaskId) : null) ??
    tasks[0] ??
    null;

  const runningCount = tasks.filter(
    (t) => t.status === "running" || t.status === "waiting_approval"
  ).length;

  let contextListHtml = "";
  if (activeTab === "workspace" || activeTab === "history") {
    contextListHtml =
      tasks.length === 0
        ? `<div class="sr-empty-leases">No orchestrated tasks yet. Launch a workflow on the right to see live progress and artifacts.</div>`
        : tasks
            .slice(0, 20)
            .map((t) => {
              const isSelected = activeTask?.id === t.id;
              const doneSteps = t.nodeExecutions.filter((n) => n.status === "completed").length;
              return `
                <div class="ac-side-item ${isSelected ? "active" : ""}" data-ac-select-task="${escapeHtml(t.id)}">
                  <div class="ac-side-item-top">
                    <strong class="ac-side-item-title">${escapeHtml(t.title)}</strong>
                    <span class="sr-pill ${statusBadgeClass(t.status)}">${escapeHtml(t.status.replace("_", " "))}</span>
                  </div>
                  <div class="ac-side-item-sub">
                    <span>${escapeHtml(t.workflowName)}</span>
                    <span>${doneSteps}/${t.nodeExecutions.length} steps</span>
                  </div>
                </div>
              `;
            })
            .join("");
  } else if (activeTab === "agents") {
    contextListHtml =
      agents.length === 0
        ? `<div class="sr-empty-leases">No agents configured. Add one from a preset template.</div>`
        : agents
            .map(
              (a) => `
                <div class="ac-side-item ${editingAgentId === a.id ? "active" : ""}" data-ac-edit-agent="${escapeHtml(a.id)}">
                  <div class="ac-side-item-top">
                    <strong class="ac-side-item-title">${escapeHtml(a.name)}</strong>
                    <span class="sr-pill ${a.enabled ? "ok" : "muted"}">${a.enabled ? "Enabled" : "Paused"}</span>
                  </div>
                  <div class="ac-side-item-sub">
                    <span>${escapeHtml(a.role)}</span>
                    <span>${a.stats.runs} runs</span>
                  </div>
                </div>
              `
            )
            .join("");
  } else {
    contextListHtml = workflows
      .map((w) => {
        const val = validateWorkflowPipeline(w, agents);
        return `
          <div class="ac-side-item ${editingWorkflowId === w.id ? "active" : ""}" data-ac-select-wf="${escapeHtml(w.id)}">
            <div class="ac-side-item-top">
              <strong class="ac-side-item-title">${escapeHtml(w.name)}</strong>
              <span class="sr-pill ${val.valid ? "ok" : "danger"}">${w.steps.length} steps</span>
            </div>
            <div class="ac-side-item-sub">
              <span>v${w.version}</span>
              <span>${val.valid ? "Valid" : `${val.errors.length} issue(s)`}</span>
            </div>
          </div>
        `;
      })
      .join("");
  }

  return `
    <div class="column-header">
      <div class="provider-title-wrap">
        <span class="provider-title">Agent Center</span>
        ${runningCount > 0 ? `<span class="count-badge">${runningCount} active</span>` : ""}
      </div>
      <div class="header-actions">
        <button id="ac-new-task-shortcut-btn" class="icon-btn primary" type="button">+ New Task</button>
      </div>
    </div>
    <div class="ac-subtabs">
      <button class="ac-subtab ${activeTab === "workspace" ? "active" : ""}" data-ac-tab="workspace" type="button">Workspace</button>
      <button class="ac-subtab ${activeTab === "agents" ? "active" : ""}" data-ac-tab="agents" type="button">Agents (${agents.length})</button>
      <button class="ac-subtab ${activeTab === "workflows" ? "active" : ""}" data-ac-tab="workflows" type="button">Pipelines (${workflows.length})</button>
      <button class="ac-subtab ${activeTab === "history" ? "active" : ""}" data-ac-tab="history" type="button">History (${tasks.length})</button>
    </div>
    <div class="ac-middle-list">${contextListHtml}</div>
    ${renderSharedChrome(state, provider)}
  `;
}

function renderWorkspaceStage(state: ManagerSnapshot, deps: AgentCenterViewDeps): string {
  const { escapeHtml } = deps;
  const workflows = state.workflows ?? [];
  const tasks = state.tasks ?? [];
  const activeTask =
    (state.activeTaskId ? tasks.find((t) => t.id === state.activeTaskId) : null) ??
    tasks[0] ??
    null;

  if (!launchDraft.workflowId || !workflows.some((w) => w.id === launchDraft.workflowId)) {
    launchDraft.workflowId = workflows[0]?.id ?? "";
  }

  const officeAssignments = deriveAgentVisualAssignments(state);
  if (
    !selectedOfficeAgentId ||
    !officeAssignments.some((a) => a.agentId === selectedOfficeAgentId)
  ) {
    selectedOfficeAgentId = officeAssignments[0]?.agentId ?? null;
  }
  const workingCount = officeAssignments.filter((a) => a.desiredActivity === "typing").length;
  const approvalCount = officeAssignments.filter((a) => a.desiredActivity === "approval").length;
  const selectedAssignment =
    officeAssignments.find((a) => a.agentId === selectedOfficeAgentId) ?? null;
  const selectedAgentRecord =
    (state.agents ?? []).find((a) => a.id === selectedOfficeAgentId) ?? null;

  const rosterButtonsHtml = officeAssignments
    .map((a) => {
      const isSelected = a.agentId === selectedOfficeAgentId;
      const dotClass =
        a.desiredActivity === "typing"
          ? "ok"
          : a.desiredActivity === "approval"
            ? "warn"
            : a.desiredActivity === "error"
              ? "danger"
              : a.desiredActivity === "sleeping"
                ? "muted"
                : "idle";
      return `
        <button
          type="button"
          class="vo-roster-chip ${isSelected ? "active" : ""}"
          data-vo-select-agent="${escapeHtml(a.agentId)}"
        >
          <span class="vo-status-led ${dotClass}" aria-hidden="true"></span>
          <span class="vo-roster-name">${escapeHtml(a.agentName)}</span>
          <span class="vo-roster-state">${escapeHtml(
            a.desiredActivity === "typing"
              ? "Working"
              : a.desiredActivity === "approval"
                ? "Approval"
                : a.desiredActivity === "sleeping"
                  ? "Paused"
                  : a.desiredActivity === "error"
                    ? "Error"
                    : "Ready"
          )}</span>
        </button>
      `;
    })
    .join("");

  const virtualOfficeHtml = `
    <section class="sr-card vo-card ${officeExpanded ? "is-expanded" : ""}">
      <div class="sr-card-head">
        <div class="vo-head-left">
          <h2>Live Virtual Office</h2>
          <span class="vo-summary-text">${officeAssignments.length} desks · ${workingCount} working${
            approvalCount > 0 ? ` · ${approvalCount} awaiting approval` : ""
          } · ${(state.accountLeases ?? []).length} active lease(s)</span>
        </div>
        <div class="vo-toolbar">
          <button id="vo-coffee-break-btn" class="mini-btn" type="button">Coffee Break</button>
          <button id="vo-toggle-labels-btn" class="mini-btn ${officeShowLabels ? "primary-text" : ""}" type="button">
            ${officeShowLabels ? "Labels On" : "Labels Off"}
          </button>
          <button id="vo-toggle-size-btn" class="mini-btn" type="button">
            ${officeExpanded ? "Compact View" : "Expand Office"}
          </button>
        </div>
      </div>

      <div id="ac-virtual-office-mount" class="vo-canvas-wrap ${officeExpanded ? "expanded" : ""}"></div>

      <div class="vo-roster-bar">${rosterButtonsHtml}</div>

      ${
        selectedAssignment && selectedAgentRecord
          ? `
            <div class="vo-inspector-bar">
              <div class="vo-inspector-info">
                <strong>${escapeHtml(selectedAssignment.agentName)}</strong>
                <span class="vo-sep" aria-hidden="true">·</span>
                <span>${escapeHtml(selectedAssignment.role)}</span>
                <span class="vo-sep" aria-hidden="true">·</span>
                <span>${escapeHtml(selectedAssignment.statusText)}</span>
                ${
                  selectedAssignment.leaseLabel
                    ? `<span class="vo-sep" aria-hidden="true">·</span><code class="ac-lease-chip">${escapeHtml(selectedAssignment.leaseLabel)}</code>`
                    : ""
                }
              </div>
              <div class="vo-inspector-actions">
                <button class="mini-btn" data-vo-toggle-enabled="${escapeHtml(selectedAgentRecord.id)}" type="button">
                  ${selectedAgentRecord.enabled ? "Pause Agent" : "Wake Agent"}
                </button>
                <button class="mini-btn primary-text" data-vo-open-profile="${escapeHtml(selectedAgentRecord.id)}" type="button">
                  Configure
                </button>
              </div>
            </div>
          `
          : ""
      }
    </section>
  `;

  const launcherHtml = `
    <section class="sr-card ac-launcher-card">
      <div class="sr-card-head">
        <div>
          <h2>Launch Multi-Stage Agent Task</h2>
          <p class="ac-card-sub">Dispatch specialists across Smart Router leases with automatic artifacts and approval gates.</p>
        </div>
        <button id="ac-toggle-launcher-btn" class="mini-btn" type="button">
          ${launcherExpanded ? "Collapse" : "Show Launcher"}
        </button>
      </div>
      ${
        launcherExpanded
          ? `
            <div class="ac-form-grid">
              <label class="sr-field">
                <span>Task Title</span>
                <input id="ac-task-title-input" class="sr-input" maxlength="100" placeholder="e.g. Q3 Product Expansion Brief" value="${escapeHtml(launchDraft.title)}" />
              </label>
              <label class="sr-field">
                <span>Workflow Pipeline</span>
                <select id="ac-task-workflow-select" class="sr-select">
                  ${workflows
                    .map(
                      (w) =>
                        `<option value="${escapeHtml(w.id)}" ${w.id === launchDraft.workflowId ? "selected" : ""}>${escapeHtml(w.name)} (${w.steps.length} steps)</option>`
                    )
                    .join("")}
                </select>
              </label>
              <label class="sr-field">
                <span>Output Format</span>
                <input id="ac-task-format-input" class="sr-input" maxlength="80" placeholder="Executive Markdown Report" value="${escapeHtml(launchDraft.outputFormat)}" />
              </label>
              <label class="sr-field">
                <span>Default Routing Strategy</span>
                <select id="ac-task-strategy-select" class="sr-select">
                  <option value="smart_balanced" ${launchDraft.routingStrategy === "smart_balanced" ? "selected" : ""}>Smart Balanced</option>
                  <option value="highest_quota" ${launchDraft.routingStrategy === "highest_quota" ? "selected" : ""}>Highest Quota</option>
                  <option value="least_busy" ${launchDraft.routingStrategy === "least_busy" ? "selected" : ""}>Least Busy</option>
                  <option value="priority_based" ${launchDraft.routingStrategy === "priority_based" ? "selected" : ""}>Priority Based</option>
                </select>
              </label>
            </div>
            <label class="sr-field ac-mt-8">
              <span>Primary Objective</span>
              <textarea id="ac-task-objective-input" class="ac-textarea" rows="2" placeholder="Describe what the pipeline should research, analyze, write, or verify...">${escapeHtml(launchDraft.objective)}</textarea>
            </label>
            <label class="sr-field ac-mt-8">
              <span>Supporting Context (optional)</span>
              <textarea id="ac-task-context-input" class="ac-textarea" rows="2" placeholder="Paste constraints, target audience, dataset notes, or links...">${escapeHtml(launchDraft.context)}</textarea>
            </label>
            ${launchDraft.error ? `<div class="update-error-box ac-mt-8">${escapeHtml(launchDraft.error)}</div>` : ""}
            <div class="ac-launcher-actions">
              <button id="ac-fill-sample-task-btn" class="mini-btn" type="button">Fill Sample Brief</button>
              <button id="ac-launch-task-btn" class="btn primary" type="button" ${launchDraft.launching ? "disabled" : ""}>
                ${launchDraft.launching ? "Launching..." : "Launch Workflow"}
              </button>
            </div>
          `
          : ""
      }
    </section>
  `;

  if (!activeTask) {
    return `
      <main class="sr-stage">
        ${virtualOfficeHtml}
        ${launcherHtml}
        <section class="sr-card ac-empty-monitor">
          <h3>Ready to Orchestrate</h3>
          <p>Fill out a task brief above or click "Fill Sample Brief" to watch specialists walk to work, acquire Smart Router leases, generate artifacts, and pass approval checkpoints.</p>
        </section>
      </main>
    `;
  }

  const totalNodes = activeTask.nodeExecutions.length || 1;
  const completedNodes = activeTask.nodeExecutions.filter((n) => n.status === "completed").length;
  const pct = Math.round((completedNodes / totalNodes) * 100);
  const currentArtifact =
    (selectedArtifactId ? activeTask.artifacts.find((a) => a.id === selectedArtifactId) : null) ??
    activeTask.artifacts[activeTask.artifacts.length - 1] ??
    null;

  const canPause = activeTask.status === "running" && !activeTask.pauseRequested;
  const canResume =
    activeTask.status === "paused" ||
    activeTask.status === "interrupted" ||
    activeTask.status === "failed";
  const canCancel =
    activeTask.status === "running" ||
    activeTask.status === "paused" ||
    activeTask.status === "waiting_approval";
  const hasFailedNode = activeTask.nodeExecutions.some((n) => n.status === "failed");

  const approvalBannerHtml =
    activeTask.status === "waiting_approval"
      ? `
        <div class="ac-approval-banner">
          <div class="ac-approval-text">
            <strong>Human Approval Gate Active</strong>
            <span>${escapeHtml(
              activeTask.nodeExecutions[activeTask.currentStepIndex]?.summary ||
                "Review generated artifacts below before authorizing final stage delivery."
            )}</span>
          </div>
          <div class="ac-approval-controls">
            <input id="ac-approval-comment-input" class="sr-input" maxlength="200" placeholder="Optional approval note..." value="${escapeHtml(approvalCommentDraft)}" />
            <button id="ac-approve-continue-btn" class="btn primary" type="button">Approve & Continue</button>
            <button id="ac-reject-cancel-btn" class="btn danger" type="button">Reject</button>
          </div>
        </div>
      `
      : "";

  const nodesHtml = activeTask.nodeExecutions
    .map((n, idx) => {
      const canRetryThis =
        n.status === "failed" ||
        (activeTask.status === "interrupted" && idx === activeTask.currentStepIndex);
      return `
        <div class="ac-node-card ${statusBadgeClass(n.status)}">
          <div class="ac-node-index">${idx + 1}</div>
          <div class="ac-node-body">
            <div class="ac-node-top">
              <div class="ac-node-title-row">
                <strong>${escapeHtml(n.title)}</strong>
                <span class="ac-kind-tag">${escapeHtml(n.kind.replace("_", " "))}</span>
                <span class="sr-pill ${statusBadgeClass(n.status)}">${escapeHtml(n.status.replace("_", " "))}</span>
              </div>
              <div class="ac-node-right">
                <span class="ac-duration">${formatDurationMs(n.startedAtMs, n.completedAtMs)}</span>
                ${
                  canRetryThis
                    ? `<button class="mini-btn primary-text" data-ac-retry-step="${idx}" type="button">Retry Stage</button>`
                    : ""
                }
              </div>
            </div>
            <div class="ac-node-meta">
              <span>Agent: <strong>${escapeHtml(n.agentName)}</strong></span>
              ${
                n.allocatedResourceLabel
                  ? `<span class="ac-lease-group">Resource: ${n.allocatedResourceLabel
                      .split(" | ")
                      .map((part) => `<code class="ac-lease-chip">${escapeHtml(part)}</code>`)
                      .join(" ")}</span>`
                  : ""
              }
              ${n.attempt > 0 ? `<span>Attempt #${n.attempt}</span>` : ""}
            </div>
            ${n.summary ? `<div class="ac-node-summary">${escapeHtml(n.summary)}</div>` : ""}
            ${n.error ? `<div class="ac-node-error">${escapeHtml(n.error)}</div>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  const artifactTabsHtml = activeTask.artifacts
    .map(
      (art) => `
        <button
          class="mini-btn ${currentArtifact?.id === art.id ? "primary-text" : ""}"
          data-ac-select-artifact="${escapeHtml(art.id)}"
          type="button"
        >
          ${escapeHtml(art.title)}
        </button>
      `
    )
    .join("");

  const eventsHtml = [...activeTask.events]
    .reverse()
    .slice(0, 30)
    .map(
      (evt) => `
        <div class="ac-log-row ${evt.level}">
          <span class="ac-log-time">${new Date(evt.timestampMs).toLocaleTimeString()}</span>
          <span class="sr-pill ${evt.level === "error" ? "danger" : evt.level === "warn" ? "warn" : evt.level === "success" ? "ok" : "running"}">${escapeHtml(evt.event)}</span>
          <span class="ac-log-detail">${escapeHtml(evt.detail)}</span>
        </div>
      `
    )
    .join("");

  return `
    <main class="sr-stage">
      ${virtualOfficeHtml}
      ${launcherHtml}

      <section class="sr-card ac-monitor-card">
        <div class="sr-card-head">
          <div>
            <div class="ac-monitor-title-row">
              <h2>${escapeHtml(activeTask.title)}</h2>
              <span class="sr-pill ${statusBadgeClass(activeTask.status)}">${escapeHtml(activeTask.status.replace("_", " "))}</span>
            </div>
            <p class="ac-card-sub">
              Pipeline: ${escapeHtml(activeTask.workflowName)} · Strategy: ${escapeHtml(activeTask.routingStrategy)} · Progress: ${completedNodes}/${totalNodes} (${pct}%)
            </p>
          </div>
          <div class="ac-monitor-actions">
            ${canPause ? `<button id="ac-pause-task-btn" class="mini-btn" type="button">Pause</button>` : ""}
            ${canResume ? `<button id="ac-resume-task-btn" class="mini-btn primary-text" type="button">Resume</button>` : ""}
            ${hasFailedNode ? `<button id="ac-retry-failed-btn" class="mini-btn primary-text" type="button">Retry Failed</button>` : ""}
            ${canCancel ? `<button id="ac-cancel-task-btn" class="mini-btn danger-text" type="button">Cancel</button>` : ""}
            ${activeTask.artifacts.length > 0 ? `<button id="ac-export-md-btn" class="btn" type="button">Export .md</button>` : ""}
          </div>
        </div>

        <div class="ac-progress-track">
          <div class="ac-progress-fill ${statusBadgeClass(activeTask.status)}" style="width:${pct}%"></div>
        </div>

        ${approvalBannerHtml}
        ${activeTask.error ? `<div class="update-error-box">${escapeHtml(activeTask.error)}</div>` : ""}

        <div class="ac-monitor-split">
          <div class="ac-timeline-col">
            <div class="sr-subhead">Execution Stages (${activeTask.nodeExecutions.length})</div>
            <div class="ac-node-list">${nodesHtml}</div>
          </div>

          <div class="ac-artifact-col">
            <div class="sr-subhead">Artifacts & Deliverables (${activeTask.artifacts.length})</div>
            ${
              activeTask.artifacts.length === 0
                ? `<div class="sr-empty-leases">Artifacts will appear here as stages complete.</div>`
                : `
                  <div class="ac-artifact-tabs">${artifactTabsHtml}</div>
                  ${
                    currentArtifact
                      ? `
                        <div class="ac-artifact-box">
                          <div class="ac-artifact-head">
                            <strong>${escapeHtml(currentArtifact.title)}</strong>
                            <span>By ${escapeHtml(currentArtifact.agentName)} · ${escapeHtml(currentArtifact.format)}</span>
                          </div>
                          <pre class="ac-artifact-content">${escapeHtml(currentArtifact.content)}</pre>
                        </div>
                      `
                      : ""
                  }
                `
            }
          </div>
        </div>

        <div class="ac-logs-section">
          <div class="sr-subhead">Orchestrator Event Log (${activeTask.events.length})</div>
          <div class="ac-log-list">${eventsHtml}</div>
        </div>
      </section>
    </main>
  `;
}

function renderAgentsStage(state: ManagerSnapshot, deps: AgentCenterViewDeps): string {
  const { escapeHtml } = deps;
  const agents = state.agents ?? [];
  const enabledProviders = state.providers.filter((p) => p.enabled);

  const presetsHtml = AGENT_TEMPLATES.map(
    (tpl) => `
      <button class="mini-btn" data-ac-apply-tpl="${escapeHtml(tpl.id)}" type="button">
        + ${escapeHtml(tpl.label)}
      </button>
    `
  ).join("");

  const cardsHtml = agents
    .map((a) => {
      const targetDesc =
        a.resourcePolicy.targetType === "external_agent"
          ? `API/CLI (${state.externalAgents.find((e) => e.id === a.resourcePolicy.externalAgentId)?.name ?? "Unlinked"})`
          : a.resourcePolicy.targetType === "pinned_account"
            ? `Pinned Account`
            : `Smart Router · ${a.resourcePolicy.providerId.toUpperCase()} (${a.resourcePolicy.routingMode})`;

      return `
        <div class="ac-agent-card ${a.enabled ? "" : "disabled"}">
          <div class="ac-agent-top">
            <div>
              <div class="ac-agent-name-row">
                <strong>${escapeHtml(a.name)}</strong>
                <span class="sr-pill ${a.enabled ? "ok" : "muted"}">${a.enabled ? "Active" : "Disabled"}</span>
              </div>
              <div class="ac-agent-role">${escapeHtml(a.role)}</div>
            </div>
            <div class="ac-agent-ops">
              <button class="mini-btn" data-ac-toggle-agent="${escapeHtml(a.id)}" type="button">${a.enabled ? "Disable" : "Enable"}</button>
              <button class="mini-btn primary-text" data-ac-edit-agent="${escapeHtml(a.id)}" type="button">Edit</button>
              <button class="mini-btn danger-text" data-ac-delete-agent="${escapeHtml(a.id)}" type="button">Delete</button>
            </div>
          </div>
          <p class="ac-agent-desc">${escapeHtml(a.description || a.instructions.slice(0, 120))}</p>
          <div class="ac-agent-meta">
            <span>Target: <strong>${escapeHtml(targetDesc)}</strong></span>
            <span>Format: ${escapeHtml(a.outputFormat)}</span>
            <span>Stats: ${a.stats.runs} runs · ${a.stats.successes} ok · ${a.stats.avgLatencyMs}ms avg</span>
          </div>
          ${
            a.capabilities.length > 0
              ? `<div class="ac-cap-row">${a.capabilities.map((c) => `<span class="ac-cap-chip">${escapeHtml(c)}</span>`).join("")}</div>`
              : ""
          }
        </div>
      `;
    })
    .join("");

  const pinnedOptions = state.accounts
    .filter((acc) => acc.providerId === agentForm.providerId)
    .map((acc) => {
      const val = `${acc.providerId}:${acc.uuid}`;
      return `<option value="${escapeHtml(val)}" ${agentForm.pinnedKey === val ? "selected" : ""}>${escapeHtml(acc.alias)}</option>`;
    })
    .join("");

  return `
    <main class="sr-stage">
      <div class="sr-stage-header">
        <div>
          <h1 class="sr-title">Agent Profiles & Specialization</h1>
          <p class="sr-subtitle">Configure role instructions, output formats, and Smart Router or API/CLI execution policies.</p>
        </div>
        <button id="ac-new-agent-btn" class="btn primary" type="button">+ Blank Agent</button>
      </div>

      <section class="sr-card">
        <div class="sr-card-head">
          <h2>Quick-Add Role Templates</h2>
        </div>
        <div class="ac-presets-wrap">${presetsHtml}</div>
      </section>

      <div class="ac-agents-layout">
        <section class="sr-card">
          <div class="sr-card-head">
            <h2>Configured Agents (${agents.length})</h2>
          </div>
          <div class="ac-agent-grid">${cardsHtml}</div>
        </section>

        <section class="sr-card">
          <div class="sr-card-head">
            <h2>${editingAgentId ? `Edit Agent: ${escapeHtml(agentForm.name)}` : "Create New Agent"}</h2>
            ${editingAgentId ? `<button id="ac-cancel-agent-edit-btn" class="mini-btn" type="button">Cancel Edit</button>` : ""}
          </div>
          <div class="ac-form-grid">
            <label class="sr-field">
              <span>Agent Name</span>
              <input id="ac-ag-name-input" class="sr-input" maxlength="50" value="${escapeHtml(agentForm.name)}" placeholder="e.g. Financial Analyst" />
            </label>
            <label class="sr-field">
              <span>Role Title</span>
              <input id="ac-ag-role-input" class="sr-input" maxlength="60" value="${escapeHtml(agentForm.role)}" placeholder="e.g. Risk & Strategy Analyst" />
            </label>
            <label class="sr-field">
              <span>Execution Target</span>
              <select id="ac-ag-target-select" class="sr-select">
                <option value="smart_router" ${agentForm.targetType === "smart_router" ? "selected" : ""}>Smart Router Pool</option>
                <option value="pinned_account" ${agentForm.targetType === "pinned_account" ? "selected" : ""}>Pinned Account</option>
                <option value="external_agent" ${agentForm.targetType === "external_agent" ? "selected" : ""}>API / CLI External Agent</option>
              </select>
            </label>
            <label class="sr-field">
              <span>Default Provider</span>
              <select id="ac-ag-provider-select" class="sr-select" ${agentForm.targetType === "external_agent" ? "disabled" : ""}>
                ${enabledProviders
                  .map(
                    (p) =>
                      `<option value="${escapeHtml(p.id)}" ${agentForm.providerId === p.id ? "selected" : ""}>${escapeHtml(p.shortName)}</option>`
                  )
                  .join("")}
              </select>
            </label>
            ${
              agentForm.targetType === "pinned_account"
                ? `
                  <label class="sr-field">
                    <span>Pinned Account</span>
                    <select id="ac-ag-pinned-select" class="sr-select">
                      <option value="">Select Account...</option>
                      ${pinnedOptions}
                    </select>
                  </label>
                `
                : agentForm.targetType === "external_agent"
                  ? `
                    <label class="sr-field">
                      <span>External API / CLI Member</span>
                      <select id="ac-ag-ext-select" class="sr-select">
                        <option value="">Select configured API/CLI...</option>
                        ${state.externalAgents
                          .map(
                            (e) =>
                              `<option value="${escapeHtml(e.id)}" ${agentForm.externalAgentId === e.id ? "selected" : ""}>${escapeHtml(e.name)} (${e.kind})</option>`
                          )
                          .join("")}
                      </select>
                    </label>
                  `
                  : `
                    <label class="sr-field">
                      <span>Routing Preference</span>
                      <select id="ac-ag-routing-select" class="sr-select">
                        <option value="smart_balanced" ${agentForm.routingMode === "smart_balanced" ? "selected" : ""}>Smart Balanced</option>
                        <option value="highest_quota" ${agentForm.routingMode === "highest_quota" ? "selected" : ""}>Highest Quota</option>
                        <option value="least_busy" ${agentForm.routingMode === "least_busy" ? "selected" : ""}>Least Busy</option>
                        <option value="priority_based" ${agentForm.routingMode === "priority_based" ? "selected" : ""}>Priority Based</option>
                      </select>
                    </label>
                  `
            }
            <label class="sr-field">
              <span>Output Format</span>
              <input id="ac-ag-format-input" class="sr-input" maxlength="60" value="${escapeHtml(agentForm.outputFormat)}" placeholder="Structured Markdown" />
            </label>
          </div>
          <label class="sr-field ac-mt-8">
            <span>Description</span>
            <input id="ac-ag-desc-input" class="sr-input" maxlength="160" value="${escapeHtml(agentForm.description)}" placeholder="Short summary of when this agent is used" />
          </label>
          <label class="sr-field ac-mt-8">
            <span>System Instructions / Prompt</span>
            <textarea id="ac-ag-inst-input" class="ac-textarea" rows="3" placeholder="Detailed instructions passed at runtime...">${escapeHtml(agentForm.instructions)}</textarea>
          </label>
          <label class="sr-field ac-mt-8">
            <span>Capabilities (comma-separated)</span>
            <input id="ac-ag-caps-input" class="sr-input" maxlength="140" value="${escapeHtml(agentForm.capabilitiesText)}" placeholder="research, analysis, fact-checking" />
          </label>
          ${agentForm.error ? `<div class="update-error-box ac-mt-8">${escapeHtml(agentForm.error)}</div>` : ""}
          <div class="ac-launcher-actions">
            <label class="sr-toggle-inline">
              <input id="ac-ag-enabled-cb" type="checkbox" ${agentForm.enabled ? "checked" : ""} />
              <span>Agent Enabled</span>
            </label>
            <button id="ac-save-agent-btn" class="btn primary" type="button" ${agentForm.saving ? "disabled" : ""}>
              ${editingAgentId ? "Save Agent" : "Create Agent"}
            </button>
          </div>
        </section>
      </div>
    </main>
  `;
}

function renderWorkflowsStage(state: ManagerSnapshot, deps: AgentCenterViewDeps): string {
  const { escapeHtml } = deps;
  const agents = state.agents ?? [];
  const draft = loadWorkflowDraft(state);
  if (!draft) {
    return `<main class="sr-stage"><section class="sr-card">No pipelines available.</section></main>`;
  }
  const validation = validateWorkflowPipeline(draft, agents);

  const stepsHtml = draft.steps
    .map((step, idx) => {
      const canEditAgent = step.kind === "agent" || step.kind === "review";
      const isParallel = step.kind === "parallel";
      const isCondition = step.kind === "condition";
      const isApproval = step.kind === "human_approval";
      const isEditableMeta = step.kind !== "start" && step.kind !== "output";

      return `
        <div class="ac-wf-step-card" data-wf-step-idx="${idx}">
          <div class="ac-wf-step-head">
            <div class="ac-wf-step-left">
              <span class="ac-node-index">${idx + 1}</span>
              <input
                class="sr-input ac-wf-step-title-input"
                data-wf-step-title="${idx}"
                value="${escapeHtml(step.title)}"
                placeholder="Stage title"
              />
              <span class="ac-kind-tag">${escapeHtml(step.kind.replace("_", " "))}</span>
            </div>
            <div class="ac-wf-step-ops">
              <button class="mini-btn" data-wf-move-up="${idx}" type="button" ${idx === 0 ? "disabled" : ""}>↑</button>
              <button class="mini-btn" data-wf-move-down="${idx}" type="button" ${idx === draft.steps.length - 1 ? "disabled" : ""}>↓</button>
              ${
                isEditableMeta
                  ? `<button class="mini-btn danger-text" data-wf-del-step="${idx}" type="button">Remove</button>`
                  : ""
              }
            </div>
          </div>

          ${
            canEditAgent
              ? `
                <div class="ac-wf-step-grid">
                  <label class="sr-field">
                    <span>Assigned Agent</span>
                    <select class="sr-select ac-wf-step-agent" data-wf-step-agent="${idx}">
                      ${agents
                        .map(
                          (a) =>
                            `<option value="${escapeHtml(a.id)}" ${step.agentId === a.id ? "selected" : ""}>${escapeHtml(a.name)} (${escapeHtml(a.role)})</option>`
                        )
                        .join("")}
                    </select>
                  </label>
                  <label class="sr-field">
                    <span>Max Retries (0–5)</span>
                    <input type="number" min="0" max="5" class="sr-input ac-wf-step-retries" data-wf-step-retries="${idx}" value="${step.maxRetries}" />
                  </label>
                </div>
              `
              : ""
          }

          ${
            isParallel
              ? `
                <div class="ac-parallel-box">
                  <div class="ac-parallel-head">
                    <span>Parallel Branches (${(step.parallelBranches ?? []).length})</span>
                    <button class="mini-btn primary-text" data-wf-add-branch="${idx}" type="button">+ Add Branch</button>
                  </div>
                  ${(step.parallelBranches ?? [])
                    .map(
                      (br, bIdx) => `
                        <div class="ac-branch-row">
                          <input class="sr-input ac-branch-title" data-wf-br-title="${idx}:${bIdx}" value="${escapeHtml(br.title)}" placeholder="Branch label" />
                          <select class="sr-select ac-branch-agent" data-wf-br-agent="${idx}:${bIdx}">
                            ${agents
                              .map(
                                (a) =>
                                  `<option value="${escapeHtml(a.id)}" ${br.agentId === a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>`
                              )
                              .join("")}
                          </select>
                          <button class="mini-btn danger-text" data-wf-del-branch="${idx}:${bIdx}" type="button" ${(step.parallelBranches ?? []).length <= 2 ? "disabled" : ""}>✕</button>
                        </div>
                      `
                    )
                    .join("")}
                </div>
              `
              : ""
          }

          ${
            isCondition
              ? `
                <div class="ac-wf-step-grid">
                  <label class="sr-field">
                    <span>Condition Metric</span>
                    <select class="sr-select ac-cond-metric" data-wf-cond-metric="${idx}">
                      <option value="min_length" ${step.condition?.metric === "min_length" ? "selected" : ""}>Minimum Chars</option>
                      <option value="contains_keyword" ${step.condition?.metric === "contains_keyword" ? "selected" : ""}>Contains Keyword</option>
                      <option value="not_contains_keyword" ${step.condition?.metric === "not_contains_keyword" ? "selected" : ""}>Excludes Keyword</option>
                    </select>
                  </label>
                  <label class="sr-field">
                    <span>Threshold / Keyword</span>
                    <input class="sr-input ac-cond-val" data-wf-cond-val="${idx}" value="${escapeHtml(step.condition?.value ?? "80")}" />
                  </label>
                  <label class="sr-field">
                    <span>Action On Fail</span>
                    <select class="sr-select ac-cond-action" data-wf-cond-action="${idx}">
                      <option value="retry_previous" ${step.condition?.actionOnFail === "retry_previous" ? "selected" : ""}>Retry Previous Stage</option>
                      <option value="continue_with_warning" ${step.condition?.actionOnFail === "continue_with_warning" ? "selected" : ""}>Continue with Warning</option>
                      <option value="halt" ${step.condition?.actionOnFail === "halt" ? "selected" : ""}>Halt Pipeline</option>
                    </select>
                  </label>
                </div>
              `
              : ""
          }

          ${
            isApproval
              ? `
                <label class="sr-field">
                  <span>Approval Gate Prompt</span>
                  <input class="sr-input ac-approval-prompt" data-wf-approval-prompt="${idx}" value="${escapeHtml(step.approvalPrompt ?? "")}" placeholder="Instructions shown when pausing for user review" />
                </label>
              `
              : ""
          }
        </div>
      `;
    })
    .join("");

  return `
    <main class="sr-stage">
      <div class="sr-stage-header">
        <div>
          <h1 class="sr-title">Structured Pipeline Builder</h1>
          <p class="sr-subtitle">Design validated linear, parallel-branch, conditional retry, and human-approval workflows.</p>
        </div>
        <div class="sr-header-controls">
          <button id="ac-new-wf-btn" class="btn" type="button">+ New Pipeline</button>
          <button id="ac-del-wf-btn" class="btn danger" type="button" ${(state.workflows ?? []).length <= 1 ? "disabled" : ""}>Delete</button>
          <button id="ac-save-wf-btn" class="btn primary" type="button">Save Pipeline</button>
        </div>
      </div>

      <section class="sr-card">
        <div class="ac-form-grid">
          <label class="sr-field">
            <span>Pipeline Name</span>
            <input id="ac-wf-name-input" class="sr-input" maxlength="80" value="${escapeHtml(draft.name)}" />
          </label>
          <label class="sr-field">
            <span>Description</span>
            <input id="ac-wf-desc-input" class="sr-input" maxlength="160" value="${escapeHtml(draft.description)}" />
          </label>
        </div>

        <div class="ac-validation-bar ${validation.valid ? "ok" : "danger"}">
          <strong>${validation.valid ? "Pipeline Validated" : "Validation Issues"}</strong>
          <span>
            ${
              validation.errors.length > 0
                ? escapeHtml(validation.errors.join(" "))
                : validation.warnings.length > 0
                  ? escapeHtml(validation.warnings.join(" "))
                  : `All ${draft.steps.length} steps verified and bounded.`
            }
          </span>
        </div>
        ${workflowFormError ? `<div class="update-error-box">${escapeHtml(workflowFormError)}</div>` : ""}

        <div class="ac-add-step-bar">
          <span>Add Stage:</span>
          <button class="mini-btn" data-wf-add-step="agent" type="button">+ Agent Step</button>
          <button class="mini-btn" data-wf-add-step="parallel" type="button">+ Parallel Pool</button>
          <button class="mini-btn" data-wf-add-step="condition" type="button">+ Condition Gate</button>
          <button class="mini-btn" data-wf-add-step="review" type="button">+ Review Step</button>
          <button class="mini-btn" data-wf-add-step="human_approval" type="button">+ Human Approval</button>
        </div>

        <div class="ac-wf-steps-list">${stepsHtml}</div>
      </section>
    </main>
  `;
}

function renderHistoryStage(state: ManagerSnapshot, deps: AgentCenterViewDeps): string {
  const { escapeHtml } = deps;
  const tasks = state.tasks ?? [];
  const q = historySearch.trim().toLowerCase();
  const filtered = tasks.filter((t) => {
    if (historyStatusFilter !== "all" && t.status !== historyStatusFilter) return false;
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      t.objective.toLowerCase().includes(q) ||
      t.workflowName.toLowerCase().includes(q)
    );
  });

  const rowsHtml =
    filtered.length === 0
      ? `<div class="sr-empty-leases">No matching task runs recorded yet.</div>`
      : filtered
          .map(
            (t) => `
              <div class="ac-history-row">
                <div class="ac-history-meta">
                  <div class="ac-node-title-row">
                    <strong>${escapeHtml(t.title)}</strong>
                    <span class="sr-pill ${statusBadgeClass(t.status)}">${escapeHtml(t.status.replace("_", " "))}</span>
                  </div>
                  <div class="ac-history-sub">
                    <span>${escapeHtml(t.workflowName)}</span>
                    <span>${t.artifacts.length} artifacts</span>
                    <span>${t.events.length} events</span>
                    <span>${new Date(t.createdAtMs).toLocaleString()}</span>
                  </div>
                </div>
                <div class="ac-history-ops">
                  <button class="mini-btn primary-text" data-ac-open-history-task="${escapeHtml(t.id)}" type="button">Inspect</button>
                  <button class="mini-btn" data-ac-export-history-task="${escapeHtml(t.id)}" type="button">Export .md</button>
                  <button class="mini-btn danger-text" data-ac-delete-history-task="${escapeHtml(t.id)}" type="button">Delete</button>
                </div>
              </div>
            `
          )
          .join("");

  return `
    <main class="sr-stage">
      <div class="sr-stage-header">
        <div>
          <h1 class="sr-title">Task History & Execution Logs</h1>
          <p class="sr-subtitle">Persisted orchestration runs, generated artifacts, and recoverable checkpoints.</p>
        </div>
        <div class="sr-header-controls">
          <input id="ac-history-search-input" class="sr-input" placeholder="Search task runs..." value="${escapeHtml(historySearch)}" />
          <select id="ac-history-status-select" class="sr-select">
            <option value="all" ${historyStatusFilter === "all" ? "selected" : ""}>All Statuses</option>
            <option value="completed" ${historyStatusFilter === "completed" ? "selected" : ""}>Completed</option>
            <option value="running" ${historyStatusFilter === "running" ? "selected" : ""}>Running</option>
            <option value="waiting_approval" ${historyStatusFilter === "waiting_approval" ? "selected" : ""}>Waiting Approval</option>
            <option value="paused" ${historyStatusFilter === "paused" ? "selected" : ""}>Paused</option>
            <option value="failed" ${historyStatusFilter === "failed" ? "selected" : ""}>Failed</option>
            <option value="interrupted" ${historyStatusFilter === "interrupted" ? "selected" : ""}>Interrupted</option>
          </select>
        </div>
      </div>

      <section class="sr-card">
        <div class="ac-history-list">${rowsHtml}</div>
      </section>
    </main>
  `;
}

export function renderAgentCenterStage(
  state: ManagerSnapshot,
  deps: AgentCenterViewDeps
): string {
  if (activeTab === "agents") return renderAgentsStage(state, deps);
  if (activeTab === "workflows") return renderWorkflowsStage(state, deps);
  if (activeTab === "history") return renderHistoryStage(state, deps);
  return renderWorkspaceStage(state, deps);
}

function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function bindAgentCenterEvents(
  state: ManagerSnapshot,
  deps: AgentCenterViewDeps
): void {
  const { callCmd, applySnapshot, rerender } = deps;

  document.querySelectorAll<HTMLButtonElement>("[data-ac-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextTab = btn.dataset.acTab as AgentCenterTab | undefined;
      if (!nextTab || nextTab === activeTab) return;
      activeTab = nextTab;
      rerender();
    });
  });

  document.querySelector("#ac-new-task-shortcut-btn")?.addEventListener("click", () => {
    activeTab = "workspace";
    launcherExpanded = true;
    rerender();
    document.querySelector<HTMLInputElement>("#ac-task-title-input")?.focus();
  });

  document.querySelectorAll<HTMLElement>("[data-ac-select-task]").forEach((el) => {
    el.addEventListener("click", async () => {
      const taskId = el.dataset.acSelectTask;
      if (!taskId) return;
      selectedArtifactId = null;
      const next = await callCmd<ManagerSnapshot>("task_select", { taskId });
      applySnapshot(next);
    });
  });

  // ── LIVE VIRTUAL OFFICE MOUNT & CONTROLS ─────────────────────────────────
  const officeMount = document.querySelector<HTMLElement>("#ac-virtual-office-mount");
  if (activeTab === "workspace" && officeMount) {
    mountOrUpdateVirtualOffice({
      container: officeMount,
      snapshot: state,
      selectedAgentId: selectedOfficeAgentId,
      showLabels: officeShowLabels,
      onSelectAgent: (agentId) => {
        selectedOfficeAgentId = agentId;
        rerender();
      },
    });
  }

  document.querySelector("#vo-coffee-break-btn")?.addEventListener("click", () => {
    sendIdleAgentsForCoffee();
  });

  document.querySelector("#vo-toggle-labels-btn")?.addEventListener("click", () => {
    officeShowLabels = !officeShowLabels;
    rerender();
  });

  document.querySelector("#vo-toggle-size-btn")?.addEventListener("click", () => {
    officeExpanded = !officeExpanded;
    rerender();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-vo-select-agent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedOfficeAgentId = btn.dataset.voSelectAgent ?? null;
      rerender();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-vo-toggle-enabled]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const agentId = btn.dataset.voToggleEnabled;
      if (!agentId) return;
      const next = await callCmd<ManagerSnapshot>("agent_toggle", { agentId });
      applySnapshot(next);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-vo-open-profile]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const aid = btn.dataset.voOpenProfile;
      const hit = (state.agents ?? []).find((a) => a.id === aid);
      if (!hit) return;
      activeTab = "agents";
      resetAgentForm(state, hit);
      rerender();
    });
  });

  // ── WORKSPACE LAUNCHER ───────────────────────────────────────────────────
  document.querySelector("#ac-toggle-launcher-btn")?.addEventListener("click", () => {
    launcherExpanded = !launcherExpanded;
    rerender();
  });

  document.querySelector<HTMLInputElement>("#ac-task-title-input")?.addEventListener("input", (ev) => {
    launchDraft.title = (ev.currentTarget as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#ac-task-format-input")?.addEventListener("input", (ev) => {
    launchDraft.outputFormat = (ev.currentTarget as HTMLInputElement).value;
  });
  document.querySelector<HTMLTextAreaElement>("#ac-task-objective-input")?.addEventListener("input", (ev) => {
    launchDraft.objective = (ev.currentTarget as HTMLTextAreaElement).value;
  });
  document.querySelector<HTMLTextAreaElement>("#ac-task-context-input")?.addEventListener("input", (ev) => {
    launchDraft.context = (ev.currentTarget as HTMLTextAreaElement).value;
  });
  document.querySelector<HTMLSelectElement>("#ac-task-workflow-select")?.addEventListener("change", (ev) => {
    launchDraft.workflowId = (ev.currentTarget as HTMLSelectElement).value;
  });
  document.querySelector<HTMLSelectElement>("#ac-task-strategy-select")?.addEventListener("change", (ev) => {
    launchDraft.routingStrategy = (ev.currentTarget as HTMLSelectElement).value as RoutingStrategy;
  });

  document.querySelector("#ac-fill-sample-task-btn")?.addEventListener("click", () => {
    const workflows = state.workflows ?? [];
    const parallelWf = workflows.find((w) => w.id === "wf_parallel_business") ?? workflows[0];
    launchDraft = {
      ...launchDraft,
      title: "AI Infrastructure Consolidation Strategy",
      objective:
        "Compare multi-provider account pooling vs single-key throughput limits and deliver a phased rollout checklist.",
      context:
        "Teams currently run Muse and Hark accounts in parallel across Research, Risk Analysis, and QA stages. Must prevent session lock collisions.",
      outputFormat: "Executive Markdown Report",
      workflowId: parallelWf?.id ?? launchDraft.workflowId,
      error: "",
    };
    rerender();
  });

  document.querySelector("#ac-launch-task-btn")?.addEventListener("click", async () => {
    if (launchDraft.launching) return;
    launchDraft.error = "";
    launchDraft.launching = true;
    rerender();
    try {
      const next = await callCmd<ManagerSnapshot>("task_create_and_start", {
        title: launchDraft.title,
        objective: launchDraft.objective,
        context: launchDraft.context,
        outputFormat: launchDraft.outputFormat,
        workflowId: launchDraft.workflowId,
        routingStrategy: launchDraft.routingStrategy,
      });
      selectedArtifactId = null;
      launchDraft.title = "";
      launchDraft.objective = "";
      launchDraft.context = "";
      applySnapshot(next);
    } catch (err) {
      launchDraft.error = String(err);
      rerender();
    } finally {
      launchDraft.launching = false;
    }
  });

  // ── LIVE TASK MONITOR CONTROLS ──────────────────────────────────────────
  const activeTask =
    (state.activeTaskId ? (state.tasks ?? []).find((t) => t.id === state.activeTaskId) : null) ??
    (state.tasks ?? [])[0] ??
    null;

  if (activeTask) {
    document.querySelector<HTMLInputElement>("#ac-approval-comment-input")?.addEventListener("input", (ev) => {
      approvalCommentDraft = (ev.currentTarget as HTMLInputElement).value;
    });

    document.querySelector("#ac-approve-continue-btn")?.addEventListener("click", async () => {
      const next = await callCmd<ManagerSnapshot>("task_approve_step", {
        taskId: activeTask.id,
        approved: true,
        comment: approvalCommentDraft,
      });
      approvalCommentDraft = "";
      applySnapshot(next);
    });

    document.querySelector("#ac-reject-cancel-btn")?.addEventListener("click", async () => {
      const next = await callCmd<ManagerSnapshot>("task_approve_step", {
        taskId: activeTask.id,
        approved: false,
        comment: approvalCommentDraft,
      });
      approvalCommentDraft = "";
      applySnapshot(next);
    });

    document.querySelector("#ac-pause-task-btn")?.addEventListener("click", async () => {
      const next = await callCmd<ManagerSnapshot>("task_pause", { taskId: activeTask.id });
      applySnapshot(next);
    });

    document.querySelector("#ac-resume-task-btn")?.addEventListener("click", async () => {
      const next = await callCmd<ManagerSnapshot>("task_resume", { taskId: activeTask.id });
      applySnapshot(next);
    });

    document.querySelector("#ac-cancel-task-btn")?.addEventListener("click", async () => {
      const next = await callCmd<ManagerSnapshot>("task_cancel", { taskId: activeTask.id });
      applySnapshot(next);
    });

    document.querySelector("#ac-retry-failed-btn")?.addEventListener("click", async () => {
      const next = await callCmd<ManagerSnapshot>("task_retry_stage", { taskId: activeTask.id });
      applySnapshot(next);
    });

    document.querySelectorAll<HTMLButtonElement>("[data-ac-retry-step]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const stepIndex = Number(btn.dataset.acRetryStep);
        const next = await callCmd<ManagerSnapshot>("task_retry_stage", {
          taskId: activeTask.id,
          stepIndex,
        });
        applySnapshot(next);
      });
    });

    document.querySelector("#ac-export-md-btn")?.addEventListener("click", () => {
      const md = formatTaskExportMarkdown(activeTask);
      const slug = activeTask.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "task";
      downloadMarkdown(`${slug}.md`, md);
    });

    document.querySelectorAll<HTMLButtonElement>("[data-ac-select-artifact]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedArtifactId = btn.dataset.acSelectArtifact ?? null;
        rerender();
      });
    });
  }

  // ── AGENTS TAB ──────────────────────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-ac-apply-tpl]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const templateId = btn.dataset.acApplyTpl;
      if (!templateId) return;
      const next = await callCmd<ManagerSnapshot>("agent_apply_template", { templateId });
      applySnapshot(next);
    });
  });

  document.querySelectorAll<HTMLElement>("[data-ac-edit-agent]").forEach((el) => {
    el.addEventListener("click", () => {
      const aid = el.dataset.acEditAgent;
      const hit = (state.agents ?? []).find((a) => a.id === aid);
      if (hit) {
        activeTab = "agents";
        resetAgentForm(state, hit);
        rerender();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-ac-toggle-agent]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const agentId = btn.dataset.acToggleAgent;
      if (!agentId) return;
      const next = await callCmd<ManagerSnapshot>("agent_toggle", { agentId });
      applySnapshot(next);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-ac-delete-agent]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const agentId = btn.dataset.acDeleteAgent;
      if (!agentId) return;
      try {
        const next = await callCmd<ManagerSnapshot>("agent_delete", { agentId });
        if (editingAgentId === agentId) resetAgentForm(next);
        applySnapshot(next);
      } catch (err) {
        agentForm.error = String(err);
        rerender();
      }
    });
  });

  document.querySelector("#ac-new-agent-btn")?.addEventListener("click", () => {
    resetAgentForm(state);
    rerender();
    document.querySelector<HTMLInputElement>("#ac-ag-name-input")?.focus();
  });

  document.querySelector("#ac-cancel-agent-edit-btn")?.addEventListener("click", () => {
    resetAgentForm(state);
    rerender();
  });

  document.querySelector<HTMLInputElement>("#ac-ag-name-input")?.addEventListener("input", (ev) => {
    agentForm.name = (ev.currentTarget as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#ac-ag-role-input")?.addEventListener("input", (ev) => {
    agentForm.role = (ev.currentTarget as HTMLInputElement).value;
  });
  document.querySelector<HTMLSelectElement>("#ac-ag-target-select")?.addEventListener("change", (ev) => {
    agentForm.targetType = (ev.currentTarget as HTMLSelectElement).value as AgentExecutionTarget;
    rerender();
  });
  document.querySelector<HTMLSelectElement>("#ac-ag-provider-select")?.addEventListener("change", (ev) => {
    agentForm.providerId = (ev.currentTarget as HTMLSelectElement).value;
    agentForm.pinnedKey = "";
    rerender();
  });
  document.querySelector<HTMLSelectElement>("#ac-ag-pinned-select")?.addEventListener("change", (ev) => {
    agentForm.pinnedKey = (ev.currentTarget as HTMLSelectElement).value;
  });
  document.querySelector<HTMLSelectElement>("#ac-ag-ext-select")?.addEventListener("change", (ev) => {
    agentForm.externalAgentId = (ev.currentTarget as HTMLSelectElement).value;
  });
  document.querySelector<HTMLSelectElement>("#ac-ag-routing-select")?.addEventListener("change", (ev) => {
    agentForm.routingMode = (ev.currentTarget as HTMLSelectElement).value as RoutingStrategy;
  });
  document.querySelector<HTMLInputElement>("#ac-ag-format-input")?.addEventListener("input", (ev) => {
    agentForm.outputFormat = (ev.currentTarget as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#ac-ag-desc-input")?.addEventListener("input", (ev) => {
    agentForm.description = (ev.currentTarget as HTMLInputElement).value;
  });
  document.querySelector<HTMLTextAreaElement>("#ac-ag-inst-input")?.addEventListener("input", (ev) => {
    agentForm.instructions = (ev.currentTarget as HTMLTextAreaElement).value;
  });
  document.querySelector<HTMLInputElement>("#ac-ag-caps-input")?.addEventListener("input", (ev) => {
    agentForm.capabilitiesText = (ev.currentTarget as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#ac-ag-enabled-cb")?.addEventListener("change", (ev) => {
    agentForm.enabled = (ev.currentTarget as HTMLInputElement).checked;
  });

  document.querySelector("#ac-save-agent-btn")?.addEventListener("click", async () => {
    if (agentForm.saving) return;
    agentForm.error = "";
    agentForm.saving = true;
    let pinnedAccount: AccountKey | null = null;
    if (agentForm.targetType === "pinned_account" && agentForm.pinnedKey.includes(":")) {
      const [providerId, uuid] = agentForm.pinnedKey.split(":");
      if (providerId && uuid) pinnedAccount = { providerId, uuid };
    }
    try {
      const next = await callCmd<ManagerSnapshot>("agent_upsert", {
        agent: {
          id: editingAgentId ?? undefined,
          name: agentForm.name,
          role: agentForm.role,
          description: agentForm.description,
          instructions: agentForm.instructions,
          capabilities: agentForm.capabilitiesText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          outputFormat: agentForm.outputFormat,
          enabled: agentForm.enabled,
          reviewRequired: agentForm.reviewRequired,
          resourcePolicy: {
            targetType: agentForm.targetType,
            providerId: agentForm.providerId,
            routingMode: agentForm.routingMode,
            pinnedAccount,
            externalAgentId: agentForm.targetType === "external_agent" ? agentForm.externalAgentId || null : null,
            accountPool: [],
            maxConcurrentTasks: 1,
          },
        },
      });
      resetAgentForm(next);
      applySnapshot(next);
    } catch (err) {
      agentForm.error = String(err);
      rerender();
    } finally {
      agentForm.saving = false;
    }
  });

  // ── WORKFLOWS TAB ───────────────────────────────────────────────────────
  document.querySelectorAll<HTMLElement>("[data-ac-select-wf]").forEach((el) => {
    el.addEventListener("click", () => {
      const wfid = el.dataset.acSelectWf;
      const hit = (state.workflows ?? []).find((w) => w.id === wfid);
      if (!hit) return;
      activeTab = "workflows";
      editingWorkflowId = hit.id;
      workflowDraft = JSON.parse(JSON.stringify(hit)) as WorkflowPipeline;
      workflowFormError = "";
      rerender();
    });
  });

  const wf = workflowDraft;
  if (activeTab === "workflows" && wf) {
    document.querySelector<HTMLInputElement>("#ac-wf-name-input")?.addEventListener("input", (ev) => {
      wf.name = (ev.currentTarget as HTMLInputElement).value;
    });
    document.querySelector<HTMLInputElement>("#ac-wf-desc-input")?.addEventListener("input", (ev) => {
      wf.description = (ev.currentTarget as HTMLInputElement).value;
    });

    document.querySelectorAll<HTMLInputElement>("[data-wf-step-title]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = Number(inp.dataset.wfStepTitle);
        if (wf.steps[idx]) wf.steps[idx].title = inp.value;
      });
    });

    document.querySelectorAll<HTMLSelectElement>("[data-wf-step-agent]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const idx = Number(sel.dataset.wfStepAgent);
        if (wf.steps[idx]) {
          wf.steps[idx].agentId = sel.value;
          rerender();
        }
      });
    });

    document.querySelectorAll<HTMLInputElement>("[data-wf-step-retries]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = Number(inp.dataset.wfStepRetries);
        if (wf.steps[idx]) {
          wf.steps[idx].maxRetries = Math.max(0, Math.min(5, Number(inp.value) || 0));
        }
      });
    });

    document.querySelectorAll<HTMLInputElement>("[data-wf-br-title]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const [sIdx, bIdx] = (inp.dataset.wfBrTitle ?? "").split(":").map(Number);
        const br = wf.steps[sIdx]?.parallelBranches?.[bIdx];
        if (br) br.title = inp.value;
      });
    });

    document.querySelectorAll<HTMLSelectElement>("[data-wf-br-agent]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const [sIdx, bIdx] = (sel.dataset.wfBrAgent ?? "").split(":").map(Number);
        const br = wf.steps[sIdx]?.parallelBranches?.[bIdx];
        if (br) {
          br.agentId = sel.value;
          rerender();
        }
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-wf-add-branch]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.wfAddBranch);
        const step = wf.steps[idx];
        const firstAgentId = (state.agents ?? [])[0]?.id ?? "";
        if (!step) return;
        step.parallelBranches = step.parallelBranches ?? [];
        step.parallelBranches.push({
          id: makeLocalId("br"),
          title: `Branch ${step.parallelBranches.length + 1}`,
          agentId: firstAgentId,
        });
        rerender();
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-wf-del-branch]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [sIdx, bIdx] = (btn.dataset.wfDelBranch ?? "").split(":").map(Number);
        const step = wf.steps[sIdx];
        if (!step?.parallelBranches || step.parallelBranches.length <= 2) return;
        step.parallelBranches.splice(bIdx, 1);
        rerender();
      });
    });

    document.querySelectorAll<HTMLSelectElement>("[data-wf-cond-metric]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const idx = Number(sel.dataset.wfCondMetric);
        const cond = wf.steps[idx]?.condition;
        if (cond) {
          cond.metric = sel.value as PipelineConditionRule["metric"];
          rerender();
        }
      });
    });

    document.querySelectorAll<HTMLInputElement>("[data-wf-cond-val]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = Number(inp.dataset.wfCondVal);
        const cond = wf.steps[idx]?.condition;
        if (cond) cond.value = inp.value;
      });
    });

    document.querySelectorAll<HTMLSelectElement>("[data-wf-cond-action]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const idx = Number(sel.dataset.wfCondAction);
        const cond = wf.steps[idx]?.condition;
        if (cond) {
          cond.actionOnFail = sel.value as PipelineConditionRule["actionOnFail"];
          rerender();
        }
      });
    });

    document.querySelectorAll<HTMLInputElement>("[data-wf-approval-prompt]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = Number(inp.dataset.wfApprovalPrompt);
        if (wf.steps[idx]) wf.steps[idx].approvalPrompt = inp.value;
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-wf-move-up]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.wfMoveUp);
        if (idx <= 0 || idx >= wf.steps.length) return;
        const tmp = wf.steps[idx - 1];
        wf.steps[idx - 1] = wf.steps[idx];
        wf.steps[idx] = tmp;
        rerender();
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-wf-move-down]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.wfMoveDown);
        if (idx < 0 || idx >= wf.steps.length - 1) return;
        const tmp = wf.steps[idx + 1];
        wf.steps[idx + 1] = wf.steps[idx];
        wf.steps[idx] = tmp;
        rerender();
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-wf-del-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.wfDelStep);
        if (idx < 0 || idx >= wf.steps.length) return;
        wf.steps.splice(idx, 1);
        rerender();
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-wf-add-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = btn.dataset.wfAddStep as PipelineNodeKind;
        const agents = state.agents ?? [];
        const firstAgent = agents[0]?.id ?? "";
        const secondAgent = agents[1]?.id ?? firstAgent;
        const newStep: PipelineStep = {
          id: makeLocalId("step"),
          title:
            kind === "parallel"
              ? "Parallel Specialist Pool"
              : kind === "condition"
                ? "Quality Gate"
                : kind === "human_approval"
                  ? "User Sign-off"
                  : kind === "review"
                    ? "Peer Review"
                    : "Agent Execution",
          kind,
          agentId: kind === "agent" || kind === "review" ? firstAgent : null,
          maxRetries: kind === "human_approval" ? 0 : 1,
          parallelBranches:
            kind === "parallel"
              ? [
                  { id: makeLocalId("br"), title: "Stream A", agentId: firstAgent },
                  { id: makeLocalId("br"), title: "Stream B", agentId: secondAgent },
                ]
              : undefined,
          condition:
            kind === "condition"
              ? {
                  metric: "min_length",
                  value: "80",
                  onPassLabel: "Proceed",
                  onFailLabel: "Retry",
                  actionOnFail: "retry_previous",
                }
              : undefined,
          approvalPrompt:
            kind === "human_approval"
              ? "Review stage output before finalizing deliverable."
              : undefined,
        };
        const outIdx = wf.steps.findIndex((s) => s.kind === "output");
        if (outIdx >= 0) {
          wf.steps.splice(outIdx, 0, newStep);
        } else {
          wf.steps.push(newStep);
        }
        rerender();
      });
    });

    document.querySelector("#ac-new-wf-btn")?.addEventListener("click", () => {
      const firstAgent = (state.agents ?? [])[0]?.id ?? "";
      const newId = makeLocalId("wf_custom");
      editingWorkflowId = newId;
      workflowFormError = "";
      workflowDraft = {
        id: newId,
        name: "Custom Multi-Stage Pipeline",
        description: "Custom specialist workflow built in Agent Center.",
        version: 1,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        steps: [
          { id: makeLocalId("s"), title: "Task Intake", kind: "start", agentId: null, maxRetries: 0 },
          { id: makeLocalId("s"), title: "Specialist Execution", kind: "agent", agentId: firstAgent, maxRetries: 1 },
          { id: makeLocalId("s"), title: "Final Deliverable", kind: "output", agentId: null, maxRetries: 0 },
        ],
      };
      rerender();
    });

    document.querySelector("#ac-del-wf-btn")?.addEventListener("click", async () => {
      workflowFormError = "";
      const savedExists = (state.workflows ?? []).some((w) => w.id === wf.id);
      if (!savedExists) {
        editingWorkflowId = (state.workflows ?? [])[0]?.id ?? null;
        workflowDraft = null;
        rerender();
        return;
      }
      try {
        const next = await callCmd<ManagerSnapshot>("workflow_delete", { workflowId: wf.id });
        editingWorkflowId = (next.workflows ?? [])[0]?.id ?? null;
        workflowDraft = null;
        applySnapshot(next);
      } catch (err) {
        workflowFormError = String(err);
        rerender();
      }
    });

    document.querySelector("#ac-save-wf-btn")?.addEventListener("click", async () => {
      workflowFormError = "";
      try {
        const isExisting = (state.workflows ?? []).some((w) => w.id === wf.id);
        const next = await callCmd<ManagerSnapshot>("workflow_upsert", {
          workflow: {
            ...wf,
            id: isExisting ? wf.id : undefined,
          },
        });
        const matched = (next.workflows ?? []).find((w) => w.name === wf.name.trim()) ?? (next.workflows ?? []).slice(-1)[0];
        editingWorkflowId = matched?.id ?? null;
        workflowDraft = null;
        applySnapshot(next);
      } catch (err) {
        workflowFormError = String(err);
        rerender();
      }
    });
  }

  // ── HISTORY TAB ─────────────────────────────────────────────────────────
  document.querySelector<HTMLInputElement>("#ac-history-search-input")?.addEventListener("input", (ev) => {
    historySearch = (ev.currentTarget as HTMLInputElement).value;
    rerender();
  });
  document.querySelector<HTMLSelectElement>("#ac-history-status-select")?.addEventListener("change", (ev) => {
    historyStatusFilter = (ev.currentTarget as HTMLSelectElement).value as "all" | TaskStatus;
    rerender();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-ac-open-history-task]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const taskId = btn.dataset.acOpenHistoryTask;
      if (!taskId) return;
      selectedArtifactId = null;
      activeTab = "workspace";
      const next = await callCmd<ManagerSnapshot>("task_select", { taskId });
      applySnapshot(next);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-ac-export-history-task]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const taskId = btn.dataset.acExportHistoryTask;
      const t = (state.tasks ?? []).find((x) => x.id === taskId);
      if (!t) return;
      const md = formatTaskExportMarkdown(t);
      const slug = t.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "task";
      downloadMarkdown(`${slug}.md`, md);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-ac-delete-history-task]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const taskId = btn.dataset.acDeleteHistoryTask;
      if (!taskId) return;
      const next = await callCmd<ManagerSnapshot>("task_delete", { taskId });
      applySnapshot(next);
    });
  });
}
