import type {
  AccountLease,
  AgentProfile,
  ManagerSnapshot,
  OrchestratedTask,
  PipelineStep,
} from "../types";

export const OFFICE_COLS = 44;
export const OFFICE_ROWS = 12;

export type TileKind =
  | "wall"
  | "window"
  | "floor"
  | "carpet_work"
  | "carpet_pantry"
  | "carpet_lounge"
  | "desk"
  | "chair"
  | "coffee_machine"
  | "cooler"
  | "meeting_table"
  | "whiteboard"
  | "server_rack"
  | "sofa"
  | "plant";

export interface GridPoint {
  x: number;
  y: number;
}

export interface DeskSlot {
  index: number;
  deskPos: GridPoint;
  chairPos: GridPoint;
  facing: "up" | "down";
}

export type AgentActivity =
  | "typing"
  | "approval"
  | "error"
  | "sleeping"
  | "fetching_coffee"
  | "returning_coffee"
  | "lounging"
  | "idle";

export interface AgentVisualAssignment {
  agentId: string;
  agentName: string;
  role: string;
  desiredActivity: AgentActivity;
  statusText: string;
  leaseLabel: string | null;
  providerId: string;
  monitorColor: string;
  shirtColor: string;
  hairColor: string;
  paperStacks: number;
  activeNodeTitle: string | null;
  activeStepIndex: number | null;
  isWaitingApproval: boolean;
}

export interface SimAgent {
  agentId: string;
  deskIndex: number;
  x: number; // tile-space float
  y: number;
  path: GridPoint[];
  activity: AgentActivity;
  desiredActivity: AgentActivity;
  facing: "up" | "down" | "left" | "right";
  hasCoffee: boolean;
  idleCooldown: number;
  pauseTimer: number;
  animPhase: number;
  assignment: AgentVisualAssignment;
}

export interface SimCat {
  x: number;
  y: number;
  path: GridPoint[];
  waitTimer: number;
  facing: "left" | "right";
  sleeping: boolean;
  animPhase: number;
}

export interface OfficeSimulation {
  grid: TileKind[][];
  desks: DeskSlot[];
  coffeeSpot: GridPoint;
  meetingSpots: GridPoint[];
  agents: SimAgent[];
  cat: SimCat;
  tickCount: number;
}

export const DESK_SLOTS: DeskSlot[] = [
  { index: 0, deskPos: { x: 3, y: 3 }, chairPos: { x: 3, y: 4 }, facing: "up" },
  { index: 1, deskPos: { x: 9, y: 3 }, chairPos: { x: 9, y: 4 }, facing: "up" },
  { index: 2, deskPos: { x: 15, y: 3 }, chairPos: { x: 15, y: 4 }, facing: "up" },
  { index: 3, deskPos: { x: 21, y: 3 }, chairPos: { x: 21, y: 4 }, facing: "up" },
  { index: 4, deskPos: { x: 3, y: 7 }, chairPos: { x: 3, y: 8 }, facing: "up" },
  { index: 5, deskPos: { x: 9, y: 7 }, chairPos: { x: 9, y: 8 }, facing: "up" },
  { index: 6, deskPos: { x: 15, y: 7 }, chairPos: { x: 15, y: 8 }, facing: "up" },
  { index: 7, deskPos: { x: 21, y: 7 }, chairPos: { x: 21, y: 8 }, facing: "up" },
];

export const COFFEE_SPOT: GridPoint = { x: 34, y: 3 };
export const MEETING_SPOTS: GridPoint[] = [
  { x: 33, y: 7 },
  { x: 38, y: 7 },
  { x: 35, y: 6 },
  { x: 36, y: 9 },
];

export function buildOfficeGrid(): TileKind[][] {
  const grid: TileKind[][] = [];
  for (let y = 0; y < OFFICE_ROWS; y += 1) {
    const row: TileKind[] = [];
    for (let x = 0; x < OFFICE_COLS; x += 1) {
      if (y === 0 || y === OFFICE_ROWS - 1 || x === 0 || x === OFFICE_COLS - 1) {
        row.push("wall");
      } else if (x >= 30 && y <= 5) {
        row.push("carpet_pantry");
      } else if (x >= 30 && y >= 6) {
        row.push("carpet_lounge");
      } else if (x >= 2 && x <= 24 && y >= 2 && y <= 10) {
        row.push("carpet_work");
      } else {
        row.push("floor");
      }
    }
    grid.push(row);
  }

  // Top windows & fixtures along y=1 (front wall trim)
  for (const wx of [3, 4, 5, 9, 10, 11, 15, 16, 17, 21, 22]) {
    grid[1][wx] = "window";
  }
  grid[1][6] = "whiteboard";
  grid[1][7] = "whiteboard";
  grid[1][12] = "whiteboard";
  grid[1][13] = "whiteboard";
  grid[1][19] = "plant";
  grid[1][26] = "server_rack";
  grid[1][27] = "server_rack";
  grid[1][28] = "server_rack";
  grid[1][29] = "plant";

  // Pantry fixtures (top right)
  grid[1][32] = "coffee_machine";
  grid[1][33] = "coffee_machine";
  grid[1][35] = "cooler";
  grid[1][39] = "plant";
  grid[2][32] = "desk"; // pantry counter left
  grid[2][33] = "desk"; // espresso counter
  grid[2][34] = "desk"; // mug counter
  grid[2][35] = "desk"; // snack counter

  // Workstations (2-wide desk footprint visually; logical desk tile + chair tile)
  for (const slot of DESK_SLOTS) {
    grid[slot.deskPos.y][slot.deskPos.x] = "desk";
    if (slot.deskPos.x + 1 < OFFICE_COLS - 1) {
      grid[slot.deskPos.y][slot.deskPos.x + 1] = "desk";
    }
    grid[slot.chairPos.y][slot.chairPos.x] = "chair";
  }

  // Meeting table (bottom right)
  grid[7][34] = "meeting_table";
  grid[7][35] = "meeting_table";
  grid[7][36] = "meeting_table";
  grid[7][37] = "meeting_table";
  grid[8][34] = "meeting_table";
  grid[8][35] = "meeting_table";
  grid[8][36] = "meeting_table";
  grid[8][37] = "meeting_table";

  // Lounge sofa & plants
  grid[10][39] = "sofa";
  grid[10][40] = "sofa";
  grid[2][41] = "plant";
  grid[10][41] = "plant";
  grid[10][1] = "plant";
  grid[2][1] = "plant";

  return grid;
}

export function isTileWalkable(grid: TileKind[][], x: number, y: number): boolean {
  if (y < 1 || y >= OFFICE_ROWS - 1 || x < 1 || x >= OFFICE_COLS - 1) return false;
  const tile = grid[y][x];
  return (
    tile === "floor" ||
    tile === "carpet_work" ||
    tile === "carpet_pantry" ||
    tile === "carpet_lounge" ||
    tile === "chair"
  );
}

/**
 * Deterministic 4-directional A* pathfinder on the office tile grid.
 */
export function findOfficePath(
  grid: TileKind[][],
  start: GridPoint,
  goal: GridPoint
): GridPoint[] {
  const sx = Math.round(start.x);
  const sy = Math.round(start.y);
  const gx = Math.round(goal.x);
  const gy = Math.round(goal.y);

  if (sx === gx && sy === gy) return [];
  if (!isTileWalkable(grid, gx, gy)) return [];

  const key = (x: number, y: number) => `${x},${y}`;
  const open: Array<{ x: number; y: number; g: number; f: number }> = [
    { x: sx, y: sy, g: 0, f: Math.abs(gx - sx) + Math.abs(gy - sy) },
  ];
  const cameFrom = new Map<string, GridPoint>();
  const gScore = new Map<string, number>([[key(sx, sy), 0]]);
  const closed = new Set<string>();

  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    const cKey = key(current.x, current.y);
    if (current.x === gx && current.y === gy) {
      const path: GridPoint[] = [];
      let cursor: GridPoint | undefined = { x: gx, y: gy };
      while (cursor && !(cursor.x === sx && cursor.y === sy)) {
        path.unshift(cursor);
        cursor = cameFrom.get(key(cursor.x, cursor.y));
      }
      return path;
    }

    closed.add(cKey);

    for (const d of dirs) {
      const nx = current.x + d.dx;
      const ny = current.y + d.dy;
      const nKey = key(nx, ny);
      if (closed.has(nKey)) continue;
      if (!isTileWalkable(grid, nx, ny)) continue;

      const tentativeG = current.g + 1;
      const prevG = gScore.get(nKey);
      if (prevG === undefined || tentativeG < prevG) {
        cameFrom.set(nKey, { x: current.x, y: current.y });
        gScore.set(nKey, tentativeG);
        const h = Math.abs(gx - nx) + Math.abs(gy - ny);
        const existing = open.find((n) => n.x === nx && n.y === ny);
        if (existing) {
          existing.g = tentativeG;
          existing.f = tentativeG + h;
        } else {
          open.push({ x: nx, y: ny, g: tentativeG, f: tentativeG + h });
        }
      }
    }
  }

  return [];
}

const SHIRT_PALETTES = [
  "#3b82f6", // blue
  "#d97706", // amber
  "#059669", // emerald
  "#7c3aed", // violet
  "#0284c7", // sky
  "#db2777", // rose
  "#0d9488", // teal
  "#4f46e5", // indigo
];

const HAIR_PALETTES = [
  "#1e293b",
  "#451a03",
  "#78350f",
  "#312e81",
  "#3f3f46",
  "#7c2d12",
];

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function getAgentColors(agent: AgentProfile, index: number): {
  shirtColor: string;
  hairColor: string;
  monitorColor: string;
} {
  const lower = `${agent.name} ${agent.role}`.toLowerCase();
  let monitorColor = "#38bdf8"; // cyan default
  let shirtColor = SHIRT_PALETTES[index % SHIRT_PALETTES.length];
  if (lower.includes("research") || lower.includes("read")) {
    monitorColor = "#38bdf8";
    shirtColor = "#2563eb";
  } else if (lower.includes("analy") || lower.includes("strat") || lower.includes("code")) {
    monitorColor = "#f59e0b";
    shirtColor = "#d97706";
  } else if (lower.includes("writ") || lower.includes("editor") || lower.includes("summar")) {
    monitorColor = "#10b981";
    shirtColor = "#059669";
  } else if (lower.includes("review") || lower.includes("qa") || lower.includes("plan")) {
    monitorColor = "#a78bfa";
    shirtColor = "#7c3aed";
  }
  const hairColor = HAIR_PALETTES[hashString(agent.id) % HAIR_PALETTES.length];
  return { shirtColor, hairColor, monitorColor };
}

function findParallelStepAgentMatch(
  task: OrchestratedTask,
  stepId: string,
  agentId: string,
  state: ManagerSnapshot
): boolean {
  const wf = (state.workflows ?? []).find((w) => w.id === task.workflowId);
  const step: PipelineStep | undefined = wf?.steps.find((s) => s.id === stepId);
  return Boolean(step?.parallelBranches?.some((b) => b.agentId === agentId));
}

export function deriveAgentVisualAssignments(state: ManagerSnapshot): AgentVisualAssignment[] {
  const agents = state.agents ?? [];
  const tasks = state.tasks ?? [];
  const leases = state.accountLeases ?? [];
  const accounts = state.accounts ?? [];

  const activeTask =
    (state.activeTaskId ? tasks.find((t) => t.id === state.activeTaskId) : null) ??
    tasks.find((t) => t.status === "running" || t.status === "waiting_approval") ??
    tasks[0] ??
    null;

  const runningTasks = tasks.filter(
    (t) => t.status === "running" || t.status === "waiting_approval"
  );

  return agents.slice(0, DESK_SLOTS.length).map((agent, idx) => {
    const { shirtColor, hairColor, monitorColor } = getAgentColors(agent, idx);
    const activeLease: AccountLease | undefined = leases.find(
      (l) =>
        l.holderId.includes(agent.id) ||
        (activeTask && l.holderId.startsWith(activeTask.id) && l.holderType === "task_node")
    );

    const resolveLeaseLabel = (fallbackLabel: string | null): string | null => {
      if (activeLease) {
        const acc = accounts.find(
          (a) =>
            a.providerId === activeLease.account.providerId &&
            a.uuid === activeLease.account.uuid
        );
        return acc ? `${acc.providerId}:${acc.alias}` : activeLease.account.uuid.slice(0, 8);
      }
      return fallbackLabel;
    };

    // Check active running / waiting_approval nodes across running tasks
    let matchedTask: OrchestratedTask | null = null;
    let matchedNodeIdx = -1;

    for (const t of runningTasks) {
      const nIdx = t.nodeExecutions.findIndex((n) => {
        if (n.status !== "running" && n.status !== "waiting_approval") return false;
        if (n.agentId === agent.id) return true;
        if (n.kind === "parallel") {
          return findParallelStepAgentMatch(t, n.stepId, agent.id, state);
        }
        if (n.kind === "human_approval" && idx === 0) return true;
        return false;
      });
      if (nIdx >= 0) {
        matchedTask = t;
        matchedNodeIdx = nIdx;
        break;
      }
    }

    if (matchedTask && matchedNodeIdx >= 0) {
      const node = matchedTask.nodeExecutions[matchedNodeIdx];
      if (node.status === "waiting_approval") {
        return {
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          desiredActivity: "approval",
          statusText: `Awaiting approval · ${node.title}`,
          leaseLabel: null,
          providerId: agent.resourcePolicy.providerId,
          monitorColor: "#f59e0b",
          shirtColor,
          hairColor,
          paperStacks: Math.min(7, agent.stats.runs),
          activeNodeTitle: node.title,
          activeStepIndex: matchedNodeIdx,
          isWaitingApproval: true,
        };
      }
      return {
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        desiredActivity: "typing",
        statusText: node.title,
        leaseLabel: resolveLeaseLabel(node.allocatedResourceLabel),
        providerId: agent.resourcePolicy.providerId,
        monitorColor,
        shirtColor,
        hairColor,
        paperStacks: Math.min(7, agent.stats.runs),
        activeNodeTitle: node.title,
        activeStepIndex: matchedNodeIdx,
        isWaitingApproval: false,
      };
    }

    if (!agent.enabled) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        desiredActivity: "sleeping",
        statusText: "Paused / Off-duty",
        leaseLabel: null,
        providerId: agent.resourcePolicy.providerId,
        monitorColor: "#475569",
        shirtColor,
        hairColor,
        paperStacks: Math.min(7, agent.stats.runs),
        activeNodeTitle: null,
        activeStepIndex: null,
        isWaitingApproval: false,
      };
    }

    // Check if last active task had a failure on this agent
    if (activeTask && activeTask.status === "failed") {
      const failedNode = activeTask.nodeExecutions.find(
        (n) => n.status === "failed" && n.agentId === agent.id
      );
      if (failedNode) {
        return {
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          desiredActivity: "error",
          statusText: `Failed · ${failedNode.title}`,
          leaseLabel: null,
          providerId: agent.resourcePolicy.providerId,
          monitorColor: "#ef4444",
          shirtColor,
          hairColor,
          paperStacks: Math.min(7, agent.stats.runs),
          activeNodeTitle: failedNode.title,
          activeStepIndex: null,
          isWaitingApproval: false,
        };
      }
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      desiredActivity: "idle",
      statusText:
        agent.stats.runs > 0
          ? `Ready · ${agent.stats.runs} run${agent.stats.runs === 1 ? "" : "s"} done`
          : "Ready at desk",
      leaseLabel: null,
      providerId: agent.resourcePolicy.providerId,
      monitorColor,
      shirtColor,
      hairColor,
      paperStacks: Math.min(7, agent.stats.runs),
      activeNodeTitle: null,
      activeStepIndex: null,
      isWaitingApproval: false,
    };
  });
}

export function createOfficeSimulation(state: ManagerSnapshot): OfficeSimulation {
  const grid = buildOfficeGrid();
  const assignments = deriveAgentVisualAssignments(state);
  const agents: SimAgent[] = assignments.map((assignment, idx) => {
    const slot = DESK_SLOTS[idx];
    return {
      agentId: assignment.agentId,
      deskIndex: idx,
      x: slot.chairPos.x,
      y: slot.chairPos.y,
      path: [],
      activity:
        assignment.desiredActivity === "idle" ? "idle" : assignment.desiredActivity,
      desiredActivity: assignment.desiredActivity,
      facing: "up",
      hasCoffee: false,
      idleCooldown: 4 + (idx * 3.1) % 9,
      pauseTimer: 0,
      animPhase: idx * 0.7,
      assignment,
    };
  });

  return {
    grid,
    desks: DESK_SLOTS,
    coffeeSpot: COFFEE_SPOT,
    meetingSpots: MEETING_SPOTS,
    agents,
    cat: {
      x: 27,
      y: 6,
      path: [],
      waitTimer: 2.5,
      facing: "left",
      sleeping: false,
      animPhase: 0,
    },
    tickCount: 0,
  };
}

export function syncSimulationWithSnapshot(
  sim: OfficeSimulation,
  state: ManagerSnapshot
): void {
  const assignments = deriveAgentVisualAssignments(state);
  const existingById = new Map(sim.agents.map((a) => [a.agentId, a]));

  sim.agents = assignments.map((assignment, idx) => {
    const slot = DESK_SLOTS[idx];
    const prev = existingById.get(assignment.agentId);
    if (!prev) {
      return {
        agentId: assignment.agentId,
        deskIndex: idx,
        x: slot.chairPos.x,
        y: slot.chairPos.y,
        path: [],
        activity: assignment.desiredActivity,
        desiredActivity: assignment.desiredActivity,
        facing: "up",
        hasCoffee: false,
        idleCooldown: 4 + (idx * 2.7) % 8,
        pauseTimer: 0,
        animPhase: idx * 0.6,
        assignment,
      };
    }

    const stateChanged = prev.desiredActivity !== assignment.desiredActivity;
    prev.deskIndex = idx;
    prev.assignment = assignment;
    prev.desiredActivity = assignment.desiredActivity;

    if (stateChanged) {
      if (assignment.desiredActivity === "typing") {
        // Return briskly to desk if away
        prev.hasCoffee = false;
        prev.pauseTimer = 0;
        if (Math.hypot(prev.x - slot.chairPos.x, prev.y - slot.chairPos.y) > 0.25) {
          prev.path = findOfficePath(sim.grid, { x: prev.x, y: prev.y }, slot.chairPos);
        } else {
          prev.path = [];
          prev.x = slot.chairPos.x;
          prev.y = slot.chairPos.y;
        }
        prev.activity = "typing";
      } else if (assignment.desiredActivity === "approval") {
        const spot = sim.meetingSpots[idx % sim.meetingSpots.length];
        prev.path = findOfficePath(sim.grid, { x: prev.x, y: prev.y }, spot);
        prev.activity = "approval";
      } else if (
        assignment.desiredActivity === "sleeping" ||
        assignment.desiredActivity === "error"
      ) {
        prev.path = findOfficePath(sim.grid, { x: prev.x, y: prev.y }, slot.chairPos);
        prev.activity = assignment.desiredActivity;
      } else if (assignment.desiredActivity === "idle") {
        prev.path = findOfficePath(sim.grid, { x: prev.x, y: prev.y }, slot.chairPos);
        prev.activity = "idle";
        prev.idleCooldown = 4 + (idx * 2.5) % 7;
      }
    }

    return prev;
  });
}

export function triggerCoffeeBreakForIdleAgents(sim: OfficeSimulation): number {
  let triggered = 0;
  for (const agent of sim.agents) {
    if (agent.desiredActivity === "idle" && agent.activity === "idle") {
      const path = findOfficePath(
        sim.grid,
        { x: agent.x, y: agent.y },
        sim.coffeeSpot
      );
      if (path.length > 0) {
        agent.path = path;
        agent.activity = "fetching_coffee";
        agent.pauseTimer = 0;
        triggered += 1;
      }
    }
  }
  return triggered;
}

function advanceEntityAlongPath(
  entity: { x: number; y: number; path: GridPoint[]; facing: string },
  speedTilesPerSec: number,
  dt: number
): boolean {
  if (entity.path.length === 0) return false;
  const target = entity.path[0];
  const dx = target.x - entity.x;
  const dy = target.y - entity.y;
  const dist = Math.hypot(dx, dy);

  if (Math.abs(dx) > Math.abs(dy)) {
    entity.facing = dx >= 0 ? "right" : "left";
  } else if (Math.abs(dy) > 0.01) {
    entity.facing = dy >= 0 ? "down" : "up";
  }

  const step = speedTilesPerSec * dt;
  if (dist <= step) {
    entity.x = target.x;
    entity.y = target.y;
    entity.path.shift();
  } else {
    entity.x += (dx / dist) * step;
    entity.y += (dy / dist) * step;
  }
  return true;
}

export function stepOfficeSimulation(sim: OfficeSimulation, dtSec: number): void {
  const dt = Math.min(0.1, Math.max(0.001, dtSec));
  sim.tickCount += 1;

  for (const agent of sim.agents) {
    agent.animPhase += dt;
    const slot = DESK_SLOTS[agent.deskIndex] ?? DESK_SLOTS[0];
    const speed = agent.desiredActivity === "typing" ? 4.4 : 2.9;
    const moving = advanceEntityAlongPath(agent, speed, dt);

    if (moving) continue;

    if (
      agent.desiredActivity === "typing" ||
      agent.desiredActivity === "sleeping" ||
      agent.desiredActivity === "error"
    ) {
      agent.facing = slot.facing;
      agent.activity = agent.desiredActivity;
      continue;
    }

    if (agent.desiredActivity === "approval") {
      agent.facing = "down";
      agent.activity = "approval";
      continue;
    }

    // Idle behaviors: coffee runs & lounge breaks
    if (agent.activity === "fetching_coffee") {
      if (agent.pauseTimer <= 0) {
        agent.pauseTimer = 1.6;
        agent.facing = "up";
      } else {
        agent.pauseTimer -= dt;
        if (agent.pauseTimer <= 0) {
          agent.hasCoffee = true;
          agent.activity = "returning_coffee";
          agent.path = findOfficePath(sim.grid, { x: agent.x, y: agent.y }, slot.chairPos);
        }
      }
    } else if (agent.activity === "returning_coffee") {
      agent.activity = "idle";
      agent.facing = slot.facing;
      agent.idleCooldown = 9 + (agent.deskIndex * 2.3) % 6;
    } else if (agent.activity === "lounging") {
      if (agent.pauseTimer > 0) {
        agent.pauseTimer -= dt;
        agent.facing = "down";
      } else {
        agent.activity = "idle";
        agent.path = findOfficePath(sim.grid, { x: agent.x, y: agent.y }, slot.chairPos);
        agent.idleCooldown = 8 + (agent.deskIndex * 3.1) % 6;
      }
    } else {
      agent.facing = slot.facing;
      agent.idleCooldown -= dt;
      if (agent.idleCooldown <= 0) {
        const goCoffee = (sim.tickCount + agent.deskIndex) % 3 !== 2;
        if (goCoffee) {
          const path = findOfficePath(
            sim.grid,
            { x: agent.x, y: agent.y },
            sim.coffeeSpot
          );
          if (path.length > 0) {
            agent.path = path;
            agent.activity = "fetching_coffee";
            agent.pauseTimer = 0;
          } else {
            agent.idleCooldown = 6;
          }
        } else {
          const loungeSpot = sim.meetingSpots[agent.deskIndex % sim.meetingSpots.length];
          const path = findOfficePath(sim.grid, { x: agent.x, y: agent.y }, loungeSpot);
          if (path.length > 0) {
            agent.path = path;
            agent.activity = "lounging";
            agent.pauseTimer = 4.2;
          } else {
            agent.idleCooldown = 6;
          }
        }
      }
    }
  }

  // Cozy office cat ("Mochi") wandering gently around open floor tiles
  const cat = sim.cat;
  cat.animPhase += dt;
  const catMoving = advanceEntityAlongPath(
    cat as unknown as { x: number; y: number; path: GridPoint[]; facing: string },
    1.65,
    dt
  );
  if (!catMoving) {
    if (cat.waitTimer > 0) {
      cat.waitTimer -= dt;
      cat.sleeping = cat.waitTimer > 1.8;
    } else {
      cat.sleeping = false;
      const waypoints: GridPoint[] = [
        { x: 27, y: 6 },
        { x: 32, y: 9 },
        { x: 18, y: 5 },
        { x: 7, y: 5 },
        { x: 31, y: 4 },
        { x: 24, y: 9 },
      ];
      const nextPt = waypoints[(sim.tickCount + Math.floor(cat.animPhase)) % waypoints.length];
      cat.path = findOfficePath(sim.grid, { x: cat.x, y: cat.y }, nextPt);
      cat.waitTimer = 3.5 + (sim.tickCount % 4);
    }
  } else {
    cat.sleeping = false;
  }
}
