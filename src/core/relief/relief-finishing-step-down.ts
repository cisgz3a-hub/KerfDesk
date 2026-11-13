// Finishing steps down where roughing did not reach (rolling audit v11 W6-P2-2;
// ADR-421 Amendment 2).
//
// Where relief-roughing-reach.ts finds stock roughing missed, the finishing
// bit first rough-cuts it in levels of one depth per pass, top down, before
// its ordinary finishing pass: the twin of ADR-140 Amendment 2, which steps a
// profile finish down when half the bit is in stock. Each level is the
// finishing path itself held up to one depth per pass under the highest
// missed stock the cutter can touch there, so a level never cuts deeper than
// the finishing pass beneath it (it is only ever raised), and a level is cut
// only along the stretches where it rides above that pass.
//
// Pure: no clock, no randomness, no I/O.

import type { CncPath3dPass } from '../job';
import type { Vec3 } from '../geometry/vec3';
import type { CncTool } from '../scene';
import { kernelForTool } from '../sim';
import type { ReliefRoughingReach } from './relief-roughing-reach';

// A level point rides above its finishing row only past this rise.
const RISE_EPS_MM = 1e-3;
// A guard on the level loop; levels stop as soon as one cuts nothing.
const MAX_LEVELS = 10_000;

export type FinishingStepDown = {
  // The step-down passes, every stretch of level 1 first, to cut before the
  // finishing passes they came from.
  readonly passes: ReadonlyArray<CncPath3dPass>;
  readonly levels: number;
};

/** Step-down levels for finishing rows (relief map frame) over missed stock. */
export function finishingStepDown(
  rows: ReadonlyArray<CncPath3dPass>,
  reach: ReliefRoughingReach,
  tool: CncTool,
  depthPerPassMm: number,
): FinishingStepDown {
  if (!(depthPerPassMm > 0)) return { passes: [], levels: 0 };
  const stockTop = reach.missedCells === 0 ? null : missedStockContact(reach, tool);
  const pointed =
    tool.kind === 'v-bit' || tool.kind === 'engraving' || tool.kind === 'tapered-ball-nose';
  // Finishing keeps one move per straight stretch, so sample every half cell.
  const dense = rows.map((row) => densified(row.points, reach.map.mmPerCell / 2));
  const tops = dense.map((points) =>
    points.map((p) =>
      Math.max(
        stockTop === null ? Number.NEGATIVE_INFINITY : stockAt(reach, stockTop, p),
        stockUnderTip(reach, p, pointed),
      ),
    ),
  );
  const passes: CncPath3dPass[] = [];
  let levels = 0;
  for (let level = 1; level <= MAX_LEVELS; level += 1) {
    const before = passes.length;
    dense.forEach((points, index) => {
      const top = tops[index] ?? [];
      const held = points.map((p, i) => {
        const z = (top[i] ?? Number.NEGATIVE_INFINITY) - level * depthPerPassMm;
        return z > p.z ? { ...p, z } : p;
      });
      for (const stretch of raisedStretches(points, held, tool.diameterMm))
        passes.push({
          kind: 'path3d',
          points: stretch,
          closed: false,
          lateralFeed: 'z-rate-capped',
          reliefStepDown: true,
        });
    });
    if (passes.length === before) break;
    levels = level;
  }
  return { passes, levels };
}

// For each roughing cell, the lowest tip height at which the finishing cutter
// centred there first touches missed stock: the highest missed stock within
// its reach less the cutter's own rise at that distance. Measured to the near
// side of each cell, so a tip anywhere in the cell is covered.
function missedStockContact(reach: ReliefRoughingReach, tool: CncTool): Float32Array {
  const { map, stock, missed } = reach;
  const offsets = reachOffsets(tool, map.mmPerCell);
  const out = new Float32Array(stock.length).fill(Number.NEGATIVE_INFINITY);
  for (let index = 0; index < stock.length; index += 1) {
    if (missed[index] !== 1) continue;
    const col = index % map.widthCells;
    const row = Math.floor(index / map.widthCells);
    const height = stock[index] ?? 0;
    for (const [dx, dy, rise] of offsets) {
      const c = col + dx;
      const r = row + dy;
      if (c < 0 || r < 0 || c >= map.widthCells || r >= map.heightCells) continue;
      const target = r * map.widthCells + c;
      out[target] = Math.max(out[target] ?? Number.NEGATIVE_INFINITY, height - rise);
    }
  }
  return out;
}

// Offsets within the cutter's reach of a cell's near side, with the cutter's
// rise there.
function reachOffsets(
  tool: CncTool,
  cell: number,
): ReadonlyArray<readonly [number, number, number]> {
  const kernel = kernelForTool(tool, cell);
  const span = Math.ceil(kernel.radiusMm / cell) + 1;
  const offsets: Array<readonly [number, number, number]> = [];
  for (let dy = -span; dy <= span; dy += 1)
    for (let dx = -span; dx <= span; dx += 1) {
      const near = Math.max(0, Math.hypot(dx, dy) * cell - cell * Math.SQRT2);
      if (near <= kernel.radiusMm) offsets.push([dx, dy, kernel.surfaceDzAtRadius(near)]);
    }
  return offsets;
}

// CNC audit v3 N7-P2-1: the stock the previous bit left right under this
// tip, when that is more than one depth per pass; else nothing. Judged on the bit's own path, so a pointed tip
// riding down a band's slope is caught whatever its radius one pass up. The
// highest of the cells round the tip: for a ball or flat tip the four whose
// centres bracket it; for a pointed tip (tapered ball, V-bit, engraver) the
// 3 × 3 round its own cell, since the sweep knows roughing's cutter edge only
// to a cell and a point can sit on uncut stock between centres counted as cut.
// A ball there would read the allowance strip it side-mills beside a wall.
function stockUnderTip(reach: ReliefRoughingReach, p: Vec3, pointed: boolean): number {
  const { map, stock } = reach;
  const rows = pointed ? aroundCell(p.y / map.mmPerCell) : betweenCentres(p.y / map.mmPerCell);
  const cols = pointed ? aroundCell(p.x / map.mmPerCell) : betweenCentres(p.x / map.mmPerCell);
  let top = Number.NEGATIVE_INFINITY;
  for (const row of rows)
    for (const col of cols) {
      const c = Math.min(map.widthCells - 1, Math.max(0, col));
      const r = Math.min(map.heightCells - 1, Math.max(0, row));
      top = Math.max(top, stock[r * map.widthCells + c] ?? Number.NEGATIVE_INFINITY);
    }
  return top - p.z > reach.underTipLimitMm + RISE_EPS_MM ? top : Number.NEGATIVE_INFINITY;
}

// The two cell indices whose centres bracket a coordinate (a ball or flat tip
// spans them), and the 3 around its own cell (a pointed tip, N7-P2-1).
function betweenCentres(f: number): readonly number[] {
  return [Math.floor(f - 0.5), Math.floor(f - 0.5) + 1];
}

function aroundCell(f: number): readonly number[] {
  return [Math.floor(f) - 1, Math.floor(f), Math.floor(f) + 1];
}

function densified(points: ReadonlyArray<Vec3>, stepMm: number): ReadonlyArray<Vec3> {
  const out: Vec3[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (b === undefined) continue;
    if (a !== undefined) {
      const count = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / stepMm);
      for (let k = 1; k < count; k += 1) {
        const t = k / count;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    out.push(b);
  }
  return out;
}

function stockAt(reach: ReliefRoughingReach, contact: Float32Array, p: Vec3): number {
  const { map } = reach;
  const col = Math.min(map.widthCells - 1, Math.max(0, Math.floor(p.x / map.mmPerCell)));
  const row = Math.min(map.heightCells - 1, Math.max(0, Math.floor(p.y / map.mmPerCell)));
  return contact[row * map.widthCells + col] ?? Number.NEGATIVE_INFINITY;
}

// The stretches of one held row that ride above the finishing row, joined
// across gaps shorter than the bit.
function raisedStretches(
  row: ReadonlyArray<Vec3>,
  held: ReadonlyArray<Vec3>,
  gapMm: number,
): ReadonlyArray<ReadonlyArray<Vec3>> {
  const out: Vec3[][] = [];
  let current: Vec3[] = [];
  let gap: Vec3[] = [];
  const close = (): void => {
    if (current.length > 1) out.push(current);
    current = [];
    gap = [];
  };
  held.forEach((point, i) => {
    if (point.z > (row[i]?.z ?? point.z) + RISE_EPS_MM) {
      current.push(...gap, point);
      gap = [];
    } else if (current.length > 0) {
      gap.push(point);
      if (pathLength([current[current.length - 1] ?? point, ...gap]) > gapMm) close();
    }
  });
  close();
  return out;
}

function pathLength(points: ReadonlyArray<Vec3>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a !== undefined && b !== undefined) total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}
