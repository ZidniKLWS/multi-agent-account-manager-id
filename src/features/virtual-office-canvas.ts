import {
  createOfficeSimulation,
  DESK_SLOTS,
  OFFICE_COLS,
  OFFICE_ROWS,
  stepOfficeSimulation,
  syncSimulationWithSnapshot,
  triggerCoffeeBreakForIdleAgents,
  type OfficeSimulation,
  type SimAgent,
} from "../engine/virtual-office";
import type { ManagerSnapshot } from "../types";

export interface OfficeMountOptions {
  container: HTMLElement;
  snapshot: ManagerSnapshot;
  selectedAgentId: string | null;
  showLabels: boolean;
  onSelectAgent: (agentId: string) => void;
}

const LOGICAL_TILE = 20;
const CANVAS_W = OFFICE_COLS * LOGICAL_TILE; // 600
const CANVAS_H = OFFICE_ROWS * LOGICAL_TILE; // 300

let simInstance: OfficeSimulation | null = null;
let canvasEl: HTMLCanvasElement | null = null;
let rafId: number | null = null;
let lastFrameMs = 0;
let latestSnapshot: ManagerSnapshot | null = null;
let latestSelectedAgentId: string | null = null;
let latestShowLabels = true;
let latestOnSelect: ((agentId: string) => void) | null = null;
let hoveredAgentId: string | null = null;

function isDarkTheme(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

function ensureCanvasElement(): HTMLCanvasElement {
  if (canvasEl) return canvasEl;
  const c = document.createElement("canvas");
  c.width = CANVAS_W;
  c.height = CANVAS_H;
  c.className = "vo-canvas";
  c.setAttribute("data-testid", "virtual-office-canvas");
  c.setAttribute("aria-label", "Live Virtual Pixel Office");

  c.addEventListener("mousemove", (ev) => {
    if (!simInstance || !canvasEl) return;
    const hit = hitTestAgent(ev, canvasEl, simInstance);
    hoveredAgentId = hit?.agentId ?? null;
    c.style.cursor = hoveredAgentId ? "pointer" : "default";
  });

  c.addEventListener("mouseleave", () => {
    hoveredAgentId = null;
    c.style.cursor = "default";
  });

  c.addEventListener("click", (ev) => {
    if (!simInstance || !canvasEl || !latestOnSelect) return;
    const hit = hitTestAgent(ev, canvasEl, simInstance);
    if (hit) {
      latestOnSelect(hit.agentId);
    }
  });

  canvasEl = c;
  return c;
}

function hitTestAgent(
  ev: MouseEvent,
  canvas: HTMLCanvasElement,
  sim: OfficeSimulation
): SimAgent | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const gx = ((ev.clientX - rect.left) / rect.width) * OFFICE_COLS;
  const gy = ((ev.clientY - rect.top) / rect.height) * OFFICE_ROWS;

  for (const agent of sim.agents) {
    if (Math.hypot(gx - (agent.x + 0.5), gy - (agent.y + 0.35)) <= 1.25) {
      return agent;
    }
    const slot = DESK_SLOTS[agent.deskIndex];
    if (
      slot &&
      gx >= slot.deskPos.x - 0.3 &&
      gx <= slot.deskPos.x + 2.2 &&
      gy >= slot.deskPos.y - 0.4 &&
      gy <= slot.chairPos.y + 1.1
    ) {
      return agent;
    }
  }
  return null;
}

function px(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function drawFloorAndWalls(
  ctx: CanvasRenderingContext2D,
  sim: OfficeSimulation,
  dark: boolean,
  snap: ManagerSnapshot
): void {
  const wallOuter = dark ? "#0b0f1a" : "#2e2a3b";
  const wallTop = dark ? "#1d273b" : "#d8d1c5";
  const wallTrim = dark ? "#2a3752" : "#b9b0a1";
  const floorA = dark ? "#141c2c" : "#ebd9bc";
  const floorB = dark ? "#121928" : "#e3cfaf";
  const workCarpetA = dark ? "#1a253a" : "#dbe5f0";
  const workCarpetB = dark ? "#182236" : "#d2deec";
  const pantryTileA = dark ? "#18282b" : "#dcece3";
  const pantryTileB = dark ? "#152326" : "#cfe4d8";
  const loungeCarpetA = dark ? "#231e36" : "#eae0f0";
  const loungeCarpetB = dark ? "#1f1a30" : "#e0d4ea";

  for (let y = 0; y < OFFICE_ROWS; y += 1) {
    for (let x = 0; x < OFFICE_COLS; x += 1) {
      const tx = x * LOGICAL_TILE;
      const ty = y * LOGICAL_TILE;
      const tile = sim.grid[y][x];
      const checker = (x + y) % 2 === 0;

      if (y === 0 || y === OFFICE_ROWS - 1 || x === 0 || x === OFFICE_COLS - 1) {
        px(ctx, tx, ty, LOGICAL_TILE, LOGICAL_TILE, wallOuter);
        if (y === 0) {
          px(ctx, tx, ty + 14, LOGICAL_TILE, 6, wallTrim);
        }
        continue;
      }

      if (y === 1) {
        px(ctx, tx, ty, LOGICAL_TILE, LOGICAL_TILE, wallTop);
        px(ctx, tx, ty + LOGICAL_TILE - 3, LOGICAL_TILE, 3, wallTrim);
      } else if (x >= 30 && y <= 5) {
        px(ctx, tx, ty, LOGICAL_TILE, LOGICAL_TILE, checker ? pantryTileA : pantryTileB);
      } else if (x >= 30 && y >= 6) {
        px(ctx, tx, ty, LOGICAL_TILE, LOGICAL_TILE, checker ? loungeCarpetA : loungeCarpetB);
      } else if (x >= 2 && x <= 24 && y >= 2 && y <= 10) {
        px(ctx, tx, ty, LOGICAL_TILE, LOGICAL_TILE, checker ? workCarpetA : workCarpetB);
      } else {
        px(ctx, tx, ty, LOGICAL_TILE, LOGICAL_TILE, checker ? floorA : floorB);
        // subtle plank seam
        px(ctx, tx, ty + 9, LOGICAL_TILE, 1, dark ? "rgba(255,255,255,0.03)" : "rgba(120,90,45,0.08)");
      }

      // Zone wall fixtures along row 1
      if (tile === "window") {
        px(ctx, tx + 2, ty + 2, LOGICAL_TILE - 4, LOGICAL_TILE - 6, dark ? "#0d1b38" : "#93c5fd");
        px(ctx, tx + 3, ty + 3, LOGICAL_TILE - 6, LOGICAL_TILE - 8, dark ? "#172554" : "#bae6fd");
        if (dark) {
          px(ctx, tx + 6, ty + 5, 1, 1, "#fde68a");
          px(ctx, tx + 13, ty + 8, 1, 1, "#e2e8f0");
        } else {
          px(ctx, tx + 5, ty + 5, 5, 2, "#ffffff");
        }
        px(ctx, tx + 9, ty + 2, 2, LOGICAL_TILE - 6, wallTrim);
      } else if (tile === "whiteboard") {
        px(ctx, tx + 1, ty + 2, LOGICAL_TILE - 2, LOGICAL_TILE - 6, "#94a3b8");
        px(ctx, tx + 2, ty + 3, LOGICAL_TILE - 4, LOGICAL_TILE - 8, "#f8fafc");
        px(ctx, tx + 4, ty + 6, 8, 2, "#3b82f6");
        px(ctx, tx + 4, ty + 10, 10, 1, "#64748b");
        px(ctx, tx + 14, ty + 5, 3, 3, "#fde047");
      } else if (tile === "server_rack") {
        px(ctx, tx + 2, ty + 1, LOGICAL_TILE - 4, LOGICAL_TILE - 2, "#1e293b");
        px(ctx, tx + 4, ty + 3, LOGICAL_TILE - 8, LOGICAL_TILE - 6, "#0f172a");
        // Live LEDs reflecting accounts + active leases
        const accounts = snap.accounts;
        const leases = snap.accountLeases ?? [];
        const offset = Math.max(0, (x - 26) * 4);
        for (let i = 0; i < 4; i += 1) {
          const acc = accounts[(offset + i) % Math.max(1, accounts.length)];
          let led = "#334155";
          if (acc && offset + i < accounts.length) {
            const busy = leases.some(
              (l) => l.account.providerId === acc.providerId && l.account.uuid === acc.uuid
            );
            led = busy ? "#38bdf8" : acc.authState === "authenticated" ? "#10b981" : "#f59e0b";
          }
          px(ctx, tx + 5 + (i % 2) * 5, ty + 5 + Math.floor(i / 2) * 5, 3, 2, led);
        }
      } else if (tile === "coffee_machine") {
        px(ctx, tx + 3, ty + 3, 14, 14, "#334155");
        px(ctx, tx + 5, ty + 5, 10, 5, "#475569");
        px(ctx, tx + 7, ty + 11, 6, 5, "#0f172a");
        px(ctx, tx + 8, ty + 12, 4, 3, "#78350f");
        px(ctx, tx + 14, ty + 5, 2, 2, "#10b981");
      } else if (tile === "cooler") {
        px(ctx, tx + 5, ty + 1, 10, 7, "#bae6fd");
        px(ctx, tx + 4, ty + 8, 12, 10, "#e2e8f0");
        px(ctx, tx + 7, ty + 10, 2, 2, "#ef4444");
        px(ctx, tx + 11, ty + 10, 2, 2, "#3b82f6");
      } else if (tile === "plant") {
        px(ctx, tx + 6, ty + 12, 8, 6, "#b45309");
        px(ctx, tx + 4, ty + 5, 12, 8, "#15803d");
        px(ctx, tx + 6, ty + 3, 8, 6, "#22c55e");
      } else if (tile === "sofa") {
        px(ctx, tx + 1, ty + 4, LOGICAL_TILE - 2, 13, dark ? "#4c1d95" : "#6d28d9");
        px(ctx, tx + 2, ty + 8, LOGICAL_TILE - 4, 7, dark ? "#6d28d9" : "#8b5cf6");
        px(ctx, tx + 2, ty + 3, LOGICAL_TILE - 4, 4, dark ? "#5b21b6" : "#7c3aed");
      }
    }
  }

  // Pantry counter (row 2, cols 32..35)
  for (const cx of [32, 33, 34, 35]) {
    const tx = cx * LOGICAL_TILE;
    const ty = 2 * LOGICAL_TILE;
    px(ctx, tx, ty + 4, LOGICAL_TILE, 14, dark ? "#475569" : "#94a3b8");
    px(ctx, tx, ty + 2, LOGICAL_TILE, 5, dark ? "#64748b" : "#cbd5e1");
  }
  // Coffee mugs & snacks on pantry counter
  px(ctx, 34 * LOGICAL_TILE + 6, 2 * LOGICAL_TILE + 2, 4, 4, "#ffffff");
  px(ctx, 35 * LOGICAL_TILE + 5, 2 * LOGICAL_TILE + 1, 6, 4, "#f59e0b");

  // Meeting table (rows 7..8, cols 34..37)
  const mtX = 34 * LOGICAL_TILE;
  const mtY = 7 * LOGICAL_TILE;
  px(ctx, mtX + 3, mtY + 4, LOGICAL_TILE * 4 - 6, LOGICAL_TILE * 2 - 8, dark ? "#4b3629" : "#b88454");
  px(ctx, mtX + 5, mtY + 6, LOGICAL_TILE * 4 - 10, LOGICAL_TILE * 2 - 14, dark ? "#624634" : "#ca9665");
  // Notepad & laptop in center of meeting table
  px(ctx, mtX + 26, mtY + 14, 10, 8, "#f8fafc");
  px(ctx, mtX + 28, mtY + 16, 6, 1, "#3b82f6");
  px(ctx, mtX + 46, mtY + 14, 12, 8, "#334155");
  px(ctx, mtX + 48, mtY + 15, 8, 5, "#38bdf8");

  // Zone headers (subtle pixel labels)
  ctx.font = "bold 9px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = dark ? "rgba(226,232,240,0.45)" : "rgba(30,41,59,0.5)";
  ctx.fillText("WORKFLOOR", 2 * LOGICAL_TILE + 4, 2 * LOGICAL_TILE + 9);
  ctx.fillText("ROUTER RACK", 25 * LOGICAL_TILE + 6, 2 * LOGICAL_TILE + 9);
  ctx.fillText("COFFEE BAR", 30 * LOGICAL_TILE + 6, 2 * LOGICAL_TILE + 9);
  ctx.fillText("MEETING LOUNGE", 30 * LOGICAL_TILE + 6, 6 * LOGICAL_TILE + 10);
}

function drawWorkstations(
  ctx: CanvasRenderingContext2D,
  sim: OfficeSimulation,
  dark: boolean,
  timeSec: number
): void {
  const deskWood = dark ? "#533b2d" : "#b98553";
  const deskTop = dark ? "#6b4c3b" : "#cf9b68";
  const chairColor = dark ? "#334155" : "#64748b";

  for (const slot of DESK_SLOTS) {
    const dx = slot.deskPos.x * LOGICAL_TILE;
    const dy = slot.deskPos.y * LOGICAL_TILE;
    const cx = slot.chairPos.x * LOGICAL_TILE;
    const cy = slot.chairPos.y * LOGICAL_TILE;

    const assignedAgent = sim.agents.find((a) => a.deskIndex === slot.index);
    const isWorking = assignedAgent?.activity === "typing";
    const isError = assignedAgent?.activity === "error";

    // Ambient warm desk lamp glow in dark mode when active
    if (dark && isWorking) {
      const grad = ctx.createRadialGradient(dx + 18, dy + 10, 4, dx + 18, dy + 12, 34);
      grad.addColorStop(0, "rgba(56, 189, 248, 0.18)");
      grad.addColorStop(1, "rgba(56, 189, 248, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(dx - 16, dy - 16, 72, 64);
    }

    // Chair behind/under agent
    px(ctx, cx + 4, cy + 4, 12, 11, chairColor);
    px(ctx, cx + 5, cy + 2, 10, 4, dark ? "#475569" : "#475569");

    // 2-tile wide desk
    px(ctx, dx + 1, dy + 4, LOGICAL_TILE * 2 - 2, LOGICAL_TILE - 3, deskWood);
    px(ctx, dx + 2, dy + 2, LOGICAL_TILE * 2 - 4, LOGICAL_TILE - 6, deskTop);

    // Monitor
    const monX = dx + 12;
    const monY = dy + 3;
    px(ctx, monX, monY, 16, 10, "#1e293b");
    const screenColor = assignedAgent
      ? isError
        ? "#ef4444"
        : assignedAgent.activity === "sleeping"
          ? "#334155"
          : assignedAgent.assignment.monitorColor
      : "#334155";
    px(ctx, monX + 2, monY + 1, 12, 7, screenColor);
    // Typing scanline shimmer on active monitor
    if (isWorking) {
      const lineOffset = Math.floor(timeSec * 6) % 4;
      px(ctx, monX + 3, monY + 2 + lineOffset, 8, 1, "#ffffff");
      px(ctx, monX + 3, monY + 4 + ((lineOffset + 2) % 3), 6, 1, "rgba(255,255,255,0.7)");
    }
    // Monitor stand + keyboard
    px(ctx, monX + 6, monY + 10, 4, 2, "#334155");
    px(ctx, dx + 13, dy + 15, 14, 3, "#e2e8f0");

    // Paper piles on left side of desk (token/run meter)
    const stacks = assignedAgent?.assignment.paperStacks ?? 0;
    for (let s = 0; s < stacks; s += 1) {
      px(ctx, dx + 4, dy + 12 - s, 6, 3, s % 2 === 0 ? "#f8fafc" : "#cbd5e1");
    }

    // Coffee mug on right side of desk if agent brought coffee back
    if (assignedAgent?.hasCoffee && assignedAgent.activity !== "fetching_coffee") {
      px(ctx, dx + 31, dy + 8, 4, 4, "#ffffff");
      px(ctx, dx + 32, dy + 8, 2, 2, "#78350f");
    }
  }
}

function drawAgentCharacter(
  ctx: CanvasRenderingContext2D,
  agent: SimAgent,
  selected: boolean,
  hovered: boolean,
  showLabels: boolean,
  dark: boolean
): void {
  const cx = Math.round(agent.x * LOGICAL_TILE);
  const cy = Math.round(agent.y * LOGICAL_TILE);
  const { shirtColor, hairColor } = agent.assignment;
  const isMoving = agent.path.length > 0;
  const walkStep = isMoving ? Math.sin(agent.animPhase * 12) : 0;
  const bob = isMoving ? Math.abs(Math.sin(agent.animPhase * 12)) * -1.5 : 0;
  const typeBeat = agent.activity === "typing" ? Math.floor(agent.animPhase * 8) % 2 : 0;

  // Selection / Hover highlight ring
  if (selected || hovered) {
    ctx.strokeStyle = selected ? "#3b82f6" : "#93c5fd";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx + 1, cy - 3, 18, 22);
  }

  // Shadow
  px(ctx, cx + 4, cy + 16, 12, 3, "rgba(15,23,42,0.28)");

  // Legs
  const leftLegY = cy + 12 + (walkStep > 0.3 ? -1 : 0);
  const rightLegY = cy + 12 + (walkStep < -0.3 ? -1 : 0);
  px(ctx, cx + 6, leftLegY, 3, 4, "#1e293b");
  px(ctx, cx + 11, rightLegY, 3, 4, "#1e293b");

  // Torso / shirt
  px(ctx, cx + 5, cy + 6 + bob, 10, 7, shirtColor);
  // Arms (animated typing when working at desk!)
  const leftArmY = cy + 7 + bob + (agent.activity === "typing" ? (typeBeat === 0 ? -1 : 1) : 0);
  const rightArmY = cy + 7 + bob + (agent.activity === "typing" ? (typeBeat === 1 ? -1 : 1) : 0);
  px(ctx, cx + 3, leftArmY, 2, 5, shirtColor);
  px(ctx, cx + 15, rightArmY, 2, 5, shirtColor);

  // Coffee mug in hand when returning from Coffee Bar
  if (agent.activity === "returning_coffee") {
    px(ctx, cx + 15, cy + 9 + bob, 4, 4, "#ffffff");
    px(ctx, cx + 16, cy + 9 + bob, 2, 2, "#78350f");
  }

  // Head
  px(ctx, cx + 6, cy - 1 + bob, 8, 7, "#fcd3a8");
  // Hair
  px(ctx, cx + 5, cy - 2 + bob, 10, 3, hairColor);
  if (agent.facing !== "up") {
    // Eyes
    px(ctx, cx + 7, cy + 2 + bob, 1, 2, "#0f172a");
    px(ctx, cx + 12, cy + 2 + bob, 1, 2, "#0f172a");
  }

  // Pixtuoid Status Bubbles (?, !, zZ, coffee steam)
  if (agent.activity === "approval") {
    const floatY = Math.sin(agent.animPhase * 5) * 1.5;
    px(ctx, cx + 4, cy - 14 + floatY, 12, 10, "#fef3c7");
    ctx.strokeStyle = "#d97706";
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 4, cy - 14 + floatY, 12, 10);
    ctx.fillStyle = "#b45309";
    ctx.font = "bold 9px monospace";
    ctx.fillText("?", cx + 7, cy - 6 + floatY);
  } else if (agent.activity === "error") {
    px(ctx, cx + 4, cy - 14, 12, 10, "#fee2e2");
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 4, cy - 14, 12, 10);
    ctx.fillStyle = "#b91c1c";
    ctx.font = "bold 9px monospace";
    ctx.fillText("!", cx + 8, cy - 6);
  } else if (agent.activity === "sleeping") {
    const zFloat = (agent.animPhase * 6) % 8;
    ctx.fillStyle = dark ? "#94a3b8" : "#475569";
    ctx.font = "bold 8px monospace";
    ctx.fillText("z", cx + 14, cy - 3 - zFloat);
    ctx.fillText("Z", cx + 17, cy - 8 - zFloat * 0.6);
  } else if (agent.activity === "fetching_coffee") {
    const floatY = Math.sin(agent.animPhase * 5) * 1;
    px(ctx, cx + 6, cy - 11 + floatY, 7, 6, "#ffffff");
    px(ctx, cx + 13, cy - 9 + floatY, 2, 3, "#cbd5e1");
    px(ctx, cx + 7, cy - 10 + floatY, 5, 2, "#78350f");
    px(ctx, cx + 8, cy - 14 + floatY, 1, 2, dark ? "#fde68a" : "#94a3b8");
    px(ctx, cx + 11, cy - 15 + floatY, 1, 2, dark ? "#fde68a" : "#94a3b8");
  }

  // Nameplate & active lease pill
  if (showLabels) {
    const label = agent.assignment.agentName;
    ctx.font = "600 8.5px sans-serif";
    const textW = ctx.measureText(label).width;
    const tagW = Math.min(82, textW + 8);
    const tagX = cx + 10 - tagW / 2;
    const tagY = cy + 19;
    px(
      ctx,
      tagX,
      tagY,
      tagW,
      11,
      selected
        ? "#2563eb"
        : agent.activity === "typing"
          ? dark
            ? "#065f46"
            : "#059669"
          : dark
            ? "rgba(15,23,42,0.84)"
            : "rgba(255,255,255,0.88)"
    );
    ctx.fillStyle =
      selected || agent.activity === "typing"
        ? "#ffffff"
        : dark
          ? "#e2e8f0"
          : "#0f172a";
    ctx.fillText(label.slice(0, 12), tagX + 4, tagY + 8);

    if (agent.assignment.leaseLabel && agent.activity === "typing") {
      const leaseTxt = agent.assignment.leaseLabel.split(":")[0].toUpperCase();
      ctx.font = "bold 7.5px monospace";
      ctx.fillStyle = "#38bdf8";
      ctx.fillText(leaseTxt, cx + 1, cy - 6);
    }
  }
}

function drawCat(ctx: CanvasRenderingContext2D, sim: OfficeSimulation): void {
  const cx = Math.round(sim.cat.x * LOGICAL_TILE);
  const cy = Math.round(sim.cat.y * LOGICAL_TILE);
  const tailWag = Math.sin(sim.cat.animPhase * 6) > 0 ? 1 : -1;

  px(ctx, cx + 5, cy + 14, 10, 2, "rgba(15,23,42,0.2)");
  // Ginger cat body
  px(ctx, cx + 6, cy + 10, 8, 5, "#f59e0b");
  // Head
  px(ctx, sim.cat.facing === "left" ? cx + 4 : cx + 11, cy + 8, 5, 4, "#fbbf24");
  // Ears
  px(ctx, sim.cat.facing === "left" ? cx + 4 : cx + 11, cy + 7, 1, 1, "#d97706");
  px(ctx, sim.cat.facing === "left" ? cx + 8 : cx + 15, cy + 7, 1, 1, "#d97706");
  // Tail
  px(ctx, sim.cat.facing === "left" ? cx + 14 : cx + 4, cy + 9 + tailWag, 2, 3, "#d97706");
}

function renderFrame(nowMs: number): void {
  if (!simInstance || !canvasEl || !latestSnapshot) {
    rafId = null;
    return;
  }
  const dt = lastFrameMs > 0 ? (nowMs - lastFrameMs) / 1000 : 0.016;
  lastFrameMs = nowMs;

  stepOfficeSimulation(simInstance, dt);

  const ctx = canvasEl.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    const dark = isDarkTheme();
    drawFloorAndWalls(ctx, simInstance, dark, latestSnapshot);
    drawWorkstations(ctx, simInstance, dark, nowMs / 1000);
    // Depth sort agents + cat by Y coordinate so walking overlaps look natural
    const sortedAgents = [...simInstance.agents].sort((a, b) => a.y - b.y);
    let catDrawn = false;
    for (const ag of sortedAgents) {
      if (!catDrawn && simInstance.cat.y < ag.y) {
        drawCat(ctx, simInstance);
        catDrawn = true;
      }
      drawAgentCharacter(
        ctx,
        ag,
        ag.agentId === latestSelectedAgentId,
        ag.agentId === hoveredAgentId,
        latestShowLabels,
        dark
      );
    }
    if (!catDrawn) {
      drawCat(ctx, simInstance);
    }
  }

  rafId = requestAnimationFrame(renderFrame);
}

export function mountOrUpdateVirtualOffice(opts: OfficeMountOptions): void {
  latestSnapshot = opts.snapshot;
  latestSelectedAgentId = opts.selectedAgentId;
  latestShowLabels = opts.showLabels;
  latestOnSelect = opts.onSelectAgent;

  if (!simInstance) {
    simInstance = createOfficeSimulation(opts.snapshot);
  } else {
    syncSimulationWithSnapshot(simInstance, opts.snapshot);
  }

  const canvas = ensureCanvasElement();
  if (canvas.parentElement !== opts.container) {
    opts.container.innerHTML = "";
    opts.container.appendChild(canvas);
  }

  if (rafId === null) {
    lastFrameMs = performance.now();
    rafId = requestAnimationFrame(renderFrame);
  }
}

export function getOfficeSimulationSnapshot(): OfficeSimulation | null {
  return simInstance;
}

export function sendIdleAgentsForCoffee(): number {
  if (!simInstance) return 0;
  return triggerCoffeeBreakForIdleAgents(simInstance);
}
