// A laser lead must not cross its own contour (ADR-626). The walking checks
// read the distance to the contour at samples 0.05 mm apart, and right by the
// join that distance is small anyway, so a lead could slip across a narrow
// tongue of the part beside the join between two samples. So the lead's path
// is also tested against the contour itself. Only a crossing within
// JOIN_NEIGHBOURHOOD_MM of the join, measured along the contour, is allowed:
// there a lead joins the contour and may ride its chords.
//
// A lead is fitted many times per contour (lengths, restarts), so each
// contour's edges are put on a grid once, and a check reads only the edges near
// the lead.

import type { Vec2 } from '../scene';
import { boundsOfPoints } from '../geometry/box-math';

const JOIN_NEIGHBOURHOOD_MM = 0.2;
const CELL_MM = 1;
// An edge is gridded in the cells it passes through; one passing more than this
// (100 m at 1 mm) is checked by every query instead.
const MAX_CELLS_PER_EDGE = 100_000;
// And a contour's edges take at most this many grid places in all; the edges
// past it are checked by every query, so the grid cannot outgrow memory.
const MAX_CELLS_PER_CONTOUR = 2_000_000;

type RingWalk = {
  readonly cumulative: ReadonlyArray<number>;
  readonly lengthMm: number;
  /** Edge indices (1-based, edge i runs from point i-1 to i) by grid cell. */
  readonly cells: ReadonlyMap<string, ReadonlyArray<number>>;
  readonly wide: ReadonlyArray<number>;
};

const walks = new WeakMap<ReadonlyArray<Vec2>, RingWalk>();

/** Whether `lead` crosses `ring` anywhere but beside the join at `at`. */
export function crossesOwnContour(
  lead: ReadonlyArray<Vec2>,
  at: Vec2,
  ring: ReadonlyArray<Vec2>,
): boolean {
  const walk = ringWalk(ring);
  const join = positionAlong(ring, walk, at);
  const box = boundsOfPoints(lead);
  for (const edge of edgesNear(walk, box)) {
    const a = ring[edge - 1] as Vec2;
    const b = ring[edge] as Vec2;
    if (!edgeMeetsBox(a, b, box)) continue;
    const from = walk.cumulative[edge - 1] ?? 0;
    const span = (walk.cumulative[edge] ?? 0) - from;
    for (let step = 1; step < lead.length; step += 1) {
      for (const along of touchesOnEdge(lead[step - 1] as Vec2, lead[step] as Vec2, a, b)) {
        const apart = Math.abs(from + along * span - join);
        if (Math.min(apart, walk.lengthMm - apart) > JOIN_NEIGHBOURHOOD_MM) return true;
      }
    }
  }
  return false;
}

function ringWalk(ring: ReadonlyArray<Vec2>): RingWalk {
  const known = walks.get(ring);
  if (known !== undefined) return known;
  const cumulative = [0];
  const cells = new Map<string, number[]>();
  const wide: number[] = [];
  let budget = MAX_CELLS_PER_CONTOUR;
  for (let index = 1; index < ring.length; index += 1) {
    const a = ring[index - 1] as Vec2;
    const b = ring[index] as Vec2;
    cumulative.push((cumulative[index - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
    budget -= gridEdge(cells, wide, index, a, b, budget);
  }
  const walk = { cumulative, lengthMm: cumulative[cumulative.length - 1] ?? 0, cells, wide };
  walks.set(ring, walk);
  return walk;
}

/** Grids one edge within `budget` cells and says how many it took; an edge
 * that would take more is checked by every query instead. */
function gridEdge(
  cells: Map<string, number[]>,
  wide: number[],
  edge: number,
  a: Vec2,
  b: Vec2,
  budget: number,
): number {
  const span = Math.abs(cellOf(b.x) - cellOf(a.x)) + Math.abs(cellOf(b.y) - cellOf(a.y)) + 1;
  if (!Number.isFinite(span) || span > MAX_CELLS_PER_EDGE || span > budget) {
    wide.push(edge);
    return 0;
  }
  const add = (cx: number, cy: number): void => {
    const key = `${cx},${cy}`;
    const list = cells.get(key);
    if (list === undefined) cells.set(key, [edge]);
    else if (list[list.length - 1] !== edge) list.push(edge);
  };
  walkCells(a, b, add, span + 2);
  return span;
}

/** Every grid cell the segment a-b passes through, in order (a grid walk): at
 * a cell corner both neighbours are visited, so no cell it touches is missed. */
function walkCells(
  a: Vec2,
  b: Vec2,
  visit: (cx: number, cy: number) => void,
  maxSteps: number,
): void {
  const x = axisWalk(a.x, b.x);
  const y = axisWalk(a.y, b.y);
  visit(x.cell, y.cell);
  for (let step = 0; step < maxSteps && !(x.cell === x.end && y.cell === y.end); step += 1) {
    if (x.next < y.next) advance(x);
    else if (y.next < x.next) advance(y);
    else {
      visit(x.cell + x.step, y.cell);
      visit(x.cell, y.cell + y.step);
      advance(x);
      advance(y);
    }
    visit(x.cell, y.cell);
    // Rounding can step past the end cell on its last edge: stop there.
    if (overshot(x) || overshot(y)) break;
  }
}

/** One axis of a grid walk: the cell it is in, which way it steps, and the
 * share of the segment at which it next crosses a cell edge. */
type AxisWalk = {
  cell: number;
  next: number;
  readonly step: number;
  readonly delta: number;
  readonly end: number;
};

function axisWalk(from: number, to: number): AxisWalk {
  const cell = cellOf(from);
  const step = Math.sign(to - from);
  if (step === 0) return { cell, next: Number.POSITIVE_INFINITY, step, delta: 0, end: cell };
  const boundary = (step > 0 ? cell + 1 : cell) * CELL_MM;
  return {
    cell,
    next: (boundary - from) / (to - from),
    step,
    delta: CELL_MM / Math.abs(to - from),
    end: cellOf(to),
  };
}

function advance(axis: AxisWalk): void {
  axis.cell += axis.step;
  axis.next += axis.delta;
}

function overshot(axis: AxisWalk): boolean {
  return axis.step > 0 ? axis.cell > axis.end : axis.step < 0 && axis.cell < axis.end;
}

function cellOf(value: number): number {
  return Math.floor(value / CELL_MM);
}

/** The ring's edges in the grid cells `box` covers, and every wide one. */
function edgesNear(walk: RingWalk, box: Box): ReadonlyArray<number> {
  const loX = cellOf(box.minX);
  const hiX = cellOf(box.maxX);
  const loY = cellOf(box.minY);
  const hiY = cellOf(box.maxY);
  const found = new Set<number>(walk.wide);
  // A box over more cells than the contour fills: read the filled cells in it.
  if ((hiX - loX + 1) * (hiY - loY + 1) > walk.cells.size) {
    for (const [key, edges] of walk.cells) {
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      if (cx < loX || cx > hiX || cy < loY || cy > hiY) continue;
      for (const edge of edges) found.add(edge);
    }
    return [...found];
  }
  for (let cx = loX; cx <= hiX; cx += 1) {
    for (let cy = loY; cy <= hiY; cy += 1) {
      for (const edge of walk.cells.get(`${cx},${cy}`) ?? []) found.add(edge);
    }
  }
  return [...found];
}

/** How far along the ring the point nearest `point` lies; the joins asked
 * about lie on the ring, so the edges round it are enough. */
function positionAlong(ring: ReadonlyArray<Vec2>, walk: RingWalk, point: Vec2): number {
  const near = edgesNear(walk, {
    minX: point.x - CELL_MM,
    minY: point.y - CELL_MM,
    maxX: point.x + CELL_MM,
    maxY: point.y + CELL_MM,
  });
  const edges = near.length > 0 ? near : ring.map((_, index) => index).slice(1);
  let best = Number.POSITIVE_INFINITY;
  let position = 0;
  for (const edge of edges) {
    const a = ring[edge - 1] as Vec2;
    const b = ring[edge] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const spanSq = dx * dx + dy * dy;
    const t =
      spanSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / spanSq));
    const distanceSq = (a.x + dx * t - point.x) ** 2 + (a.y + dy * t - point.y) ** 2;
    if (distanceSq < best) {
      best = distanceSq;
      const from = walk.cumulative[edge - 1] ?? 0;
      position = from + t * ((walk.cumulative[edge] ?? 0) - from);
    }
  }
  return position;
}

/** Where along edge a-b (0..1) the lead step p-q meets it: the crossing, or,
 * for a step running along the edge, both ends of the stretch they share. */
function touchesOnEdge(p: Vec2, q: Vec2, a: Vec2, b: Vec2): ReadonlyArray<number> {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const determinant = rx * sy - ry * sx;
  const wx = a.x - p.x;
  const wy = a.y - p.y;
  if (determinant === 0) return sharedStretch(p, q, a, b);
  const t = (wx * sy - wy * sx) / determinant;
  const u = (wx * ry - wy * rx) / determinant;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [u] : [];
}

// A parallel step this close to the edge's line runs along the edge.
const COLLINEAR_MM = 1e-9;

/** For a step parallel to edge a-b: the ends of the stretch of the edge it
 * runs along, as 0..1 along the edge; none when it runs beside the edge. */
function sharedStretch(p: Vec2, q: Vec2, a: Vec2, b: Vec2): ReadonlyArray<number> {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const lengthSq = sx * sx + sy * sy;
  if (lengthSq === 0) return [];
  const offLine = Math.abs((p.x - a.x) * sy - (p.y - a.y) * sx) / Math.sqrt(lengthSq);
  if (offLine > COLLINEAR_MM) return [];
  const atP = ((p.x - a.x) * sx + (p.y - a.y) * sy) / lengthSq;
  const atQ = ((q.x - a.x) * sx + (q.y - a.y) * sy) / lengthSq;
  const low = Math.max(0, Math.min(atP, atQ));
  const high = Math.min(1, Math.max(atP, atQ));
  return low <= high ? [low, high] : [];
}

type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

function edgeMeetsBox(a: Vec2, b: Vec2, box: Box): boolean {
  return (
    Math.max(a.x, b.x) >= box.minX &&
    Math.min(a.x, b.x) <= box.maxX &&
    Math.max(a.y, b.y) >= box.minY &&
    Math.min(a.y, b.y) <= box.maxY
  );
}
