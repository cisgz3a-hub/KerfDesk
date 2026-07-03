// panel-outline — walks one panel's claims into a closed rectilinear polygon
// (ADR-105). The boundary follows the outer face line over owned intervals
// and recesses by T over intervals the mate owns. Every vertex coordinate is
// taken verbatim from the shared claim boundaries (never re-accumulated), so
// mating panels and the assembly referee land on bit-identical floats.
//
// Walk order is CCW in (u, v): vMin (u ascending), uMax (v ascending),
// vMax (u descending), uMin (v descending). Each side walks its start-corner
// region and interior; its end-corner region belongs to the next side. Where
// recesses merge around a corner the raw walk emits a degenerate spike;
// cleanupRing cancels those and drops collinear midpoints.

import type { Polyline, Vec2 } from '../scene';
import type { PanelClaims, SideInterval } from './panel-claims';

/** Closed CCW outline of one panel in its local (u, v) mm frame. */
export function panelOutline(claims: PanelClaims): Polyline {
  const points: Vec2[] = [];
  for (const step of walkSteps(claims)) emitSide(points, step, claims.thicknessMm);
  const ring = cleanupRing(points);
  const first = ring[0];
  return { closed: true, points: first === undefined ? [] : [...ring, first] };
}

type SideStep = {
  readonly intervals: ReadonlyArray<SideInterval>;
  readonly endCornerOwned: boolean;
  readonly vertex: (axisPos: number, depth: number) => Vec2;
  readonly reversed: boolean;
  /** Rect corner shared with the next side, pushed inward along its normal. */
  readonly seamVertex: Vec2;
};

function walkSteps(claims: PanelClaims): ReadonlyArray<SideStep> {
  const u = claims.sizeUMm;
  const v = claims.sizeVMm;
  const t = claims.thicknessMm;
  const defs = [
    { side: 'vMin', reversed: false, vertex: xy((p, d) => [p, d]), seamVertex: { x: u - t, y: 0 } },
    {
      side: 'uMax',
      reversed: false,
      vertex: xy((p, d) => [u - d, p]),
      seamVertex: { x: u, y: v - t },
    },
    { side: 'vMax', reversed: true, vertex: xy((p, d) => [p, v - d]), seamVertex: { x: t, y: v } },
    { side: 'uMin', reversed: true, vertex: xy((p, d) => [d, p]), seamVertex: { x: 0, y: t } },
  ] as const;
  return defs.map((def) => {
    const ascending = claims.sides[def.side];
    const walkOrder = def.reversed ? [...ascending].reverse() : [...ascending];
    const endCorner = walkOrder[walkOrder.length - 1];
    return {
      intervals: walkOrder.slice(0, -1),
      endCornerOwned: endCorner?.owned ?? false,
      vertex: def.vertex,
      reversed: def.reversed,
      seamVertex: def.seamVertex,
    };
  });
}

function xy(build: (axisPos: number, depth: number) => [number, number]) {
  return (axisPos: number, depth: number): Vec2 => {
    const [x, y] = build(axisPos, depth);
    return { x, y };
  };
}

function emitSide(points: Vec2[], step: SideStep, thicknessMm: number): void {
  let lastOwned = true;
  for (const interval of step.intervals) {
    const depth = interval.owned ? 0 : thicknessMm;
    const from = step.reversed ? interval.toMm : interval.fromMm;
    const to = step.reversed ? interval.fromMm : interval.toMm;
    push(points, step.vertex(from, depth));
    push(points, step.vertex(to, depth));
    lastOwned = interval.owned;
  }
  // Recess meeting a claimed corner needs the true intermediate vertex; every
  // other seam combination either connects directly or cancels in cleanup.
  if (!lastOwned && step.endCornerOwned) push(points, step.seamVertex);
}

function push(points: Vec2[], point: Vec2): void {
  const last = points[points.length - 1];
  if (last !== undefined && last.x === point.x && last.y === point.y) return;
  points.push(point);
}

function cleanupRing(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  let ring = dedupeCyclic(points);
  for (;;) {
    if (cancelOneBacktrack(ring)) {
      ring = dedupeCyclic(ring);
      continue;
    }
    if (!dropOneCollinear(ring)) return ring;
  }
}

// P→Q→P spikes appear where two recesses merge around an unclaimed corner;
// the spike's segments coincide and cancel.
function cancelOneBacktrack(ring: Vec2[]): boolean {
  for (let i = 0; i < ring.length && ring.length >= 3; i += 1) {
    const prev = ring[(i + ring.length - 1) % ring.length];
    const next = ring[(i + 1) % ring.length];
    if (prev !== undefined && next !== undefined && prev.x === next.x && prev.y === next.y) {
      const j = (i + 1) % ring.length;
      ring.splice(Math.max(i, j), 1);
      ring.splice(Math.min(i, j), 1);
      return true;
    }
  }
  return false;
}

function dropOneCollinear(ring: Vec2[]): boolean {
  for (let i = 0; i < ring.length && ring.length >= 3; i += 1) {
    const prev = ring[(i + ring.length - 1) % ring.length];
    const curr = ring[i];
    const next = ring[(i + 1) % ring.length];
    if (prev === undefined || curr === undefined || next === undefined) continue;
    const collinear =
      (prev.x === curr.x && curr.x === next.x) || (prev.y === curr.y && curr.y === next.y);
    if (collinear) {
      ring.splice(i, 1);
      return true;
    }
  }
  return false;
}

function dedupeCyclic(points: ReadonlyArray<Vec2>): Vec2[] {
  const out: Vec2[] = [];
  for (const point of points) push(out, point);
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first !== undefined && last !== undefined) {
    if (first.x === last.x && first.y === last.y) out.pop();
  }
  return out;
}
