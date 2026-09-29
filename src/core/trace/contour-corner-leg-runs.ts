// Straight legs for the corner dial (ADR-439): from every crack point, the
// longest run of points within the line tolerance in each direction, and the
// total-least-squares line through that run.

import type { Vec2 } from '../scene';
import { hypot2 } from '../geometry/fast-hypot';

export type Leg = {
  readonly count: number;
  // Fitted line: centroid and unit direction ALONG travel.
  readonly cx: number;
  readonly cy: number;
  readonly dx: number;
  readonly dy: number;
  /** Sum of squared perpendicular residuals about the line. */
  readonly residualSq: number;
};

export type LegTolerance = { readonly base: number; readonly slope: number };

// ...plus this fraction of the leg's length: a leg is straight while its
// direction stays defined to ~2°, so threshold wobble on a long stem does not
// cut it short, while a circle's chords of that straightness are only ~0.24 R
// long and meet at under the 15° minimum turn.
export const LEG_SLOPE_TOLERANCE = 0.03;

// Leg growth also stops where the chain turns hard over a few pixels: the
// length-proportional tolerance would otherwise let a leg's far end wrap a
// few cracks round the NEXT corner (a chamfered or anti-aliased corner has no
// lattice barrier), tilting its fit. Marks a vertex stop at every peak of the
// chord turn over ±TURN_WINDOW_PX above TURN_STOP_RAD; a leg ignores the
// stops of its own corner (within its first cracks).
const TURN_WINDOW_PX = 3;
const TURN_STOP_RAD = Math.PI / 3;

export type LegRunLimits = {
  /** Most points a leg may hold. */
  readonly cap: number;
  /** Cracks a leg corner may skip at its apex. */
  readonly maxSkip: number;
  readonly scale: number;
  readonly tolerance: LegTolerance;
  /** Lattice barriers by vertex (contour-corner-lattice.ts). */
  readonly barriers: Uint8Array;
};

/** The leg ending at (`back`) and starting at (`ahead`) every crack point. */
export function straightLegs(
  pts: ReadonlyArray<Vec2>,
  limits: LegRunLimits,
): { readonly back: Leg[]; readonly ahead: Leg[] } {
  const stops = turnStops(pts, limits.scale);
  const grace = limits.maxSkip + Math.max(2, Math.round(TURN_WINDOW_PX * limits.scale));
  return {
    back: legRuns(pts, -1, limits, stops, grace),
    ahead: legRuns(pts, 1, limits, stops, grace),
  };
}

function turnStops(pts: ReadonlyArray<Vec2>, scale: number): Uint8Array {
  const n = pts.length;
  const stops = new Uint8Array(n);
  const k = Math.max(2, Math.round(TURN_WINDOW_PX * scale));
  if (n < 2 * k + 1) return stops;
  const turns = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const prev = pts[(i - k + n) % n] as Vec2;
    const at = pts[i] as Vec2;
    const next = pts[(i + k) % n] as Vec2;
    const inX = at.x - prev.x;
    const inY = at.y - prev.y;
    const outX = next.x - at.x;
    const outY = next.y - at.y;
    turns[i] = Math.abs(Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY));
  }
  // One stop per turn peak, at the vertex on the side where the turn is
  // sharper: legs end where the chain turns, not a crack short of it.
  for (let i = 0; i < n; i += 1) {
    const turn = turns[i] as number;
    const before = turns[(i - 1 + n) % n] as number;
    const after = turns[(i + 1) % n] as number;
    if (turn <= TURN_STOP_RAD || turn < before || turn < after) continue;
    stops[after >= before ? (i + 1) % n : i] = 1;
  }
  return stops;
}

// The longest straight run of points starting (step 1) or ending (step −1) at
// each index, as its fitted leg. Two pointers: a run from i+1 is at least the
// run from i minus one. A barrier at vertex v (between cracks v−1 and v) ends
// every run there. The straightness test that grew a run to its final length
// already fitted the run's line, so the leg reuses it (the same sums in the
// same order) and only a run that did not grow at its index is fitted again.
function legRuns(
  pts: ReadonlyArray<Vec2>,
  step: 1 | -1,
  limits: LegRunLimits,
  stops: Uint8Array,
  grace: number,
): Leg[] {
  const n = pts.length;
  const { cap, tolerance, barriers } = limits;
  const legs = new Array<Leg>(n);
  // Lattice barriers always end a run; turn stops only past the leg's first
  // `grace` cracks (its own corner's rounding lies within them). The vertex is
  // the one crossed when a run from i grows from `count` to `count + 1` points.
  const blocked = (i: number, count: number): boolean => {
    const vertex = step === 1 ? (i + count) % n : (((i - count + 1) % n) + n) % n;
    return barriers[vertex] !== 0 || (count >= grace && stops[vertex] === 1);
  };
  let run = 1;
  for (let k = 0; k < n; k += 1) {
    const i = step === 1 ? k : n - 1 - k;
    run = Math.max(1, Math.min(cap, run - 1));
    // The carried run may now start across a barrier (it lost its first point).
    for (let c = 1; c < run; c += 1) {
      if (blocked(i, c)) {
        run = c;
        break;
      }
    }
    let line: LegLine | null = null;
    while (run < cap && !blocked(i, run)) {
      if (run >= 2) {
        const grown = straightLine(pts, i, run + 1, step, tolerance);
        if (grown === null) break;
        line = grown;
      }
      run += 1;
    }
    // Every growth past two points passed a test, so a line is the final run's.
    legs[i] = legOf(run, line ?? legLine(pts, i, run, step));
  }
  return legs;
}

// The run's line when all `count` points from i lie within the tolerance of
// it, else null.
function straightLine(
  pts: ReadonlyArray<Vec2>,
  i: number,
  count: number,
  step: 1 | -1,
  tolerance: LegTolerance,
): LegLine | null {
  const leg = legLine(pts, i, count, step);
  const n = pts.length;
  const nx = -leg.dy;
  const ny = leg.dx;
  const first = pts[((i % n) + n) % n] as Vec2;
  const last = pts[(((i + (count - 1) * step) % n) + n) % n] as Vec2;
  const allowed = tolerance.base + tolerance.slope * hypot2(last.x - first.x, last.y - first.y);
  for (let k = 0, j = ((i % n) + n) % n; k < count; k += 1, j = wrapStep(j, step, n)) {
    const p = pts[j] as Vec2;
    if (Math.abs((p.x - leg.cx) * nx + (p.y - leg.cy) * ny) > allowed) return null;
  }
  return leg;
}

// The ring index after `j` in direction `step`: the same index as reducing
// the unrolled index modulo n, stepped instead of divided.
function wrapStep(j: number, step: 1 | -1, n: number): number {
  const next = j + step;
  if (next === n) return 0;
  return next < 0 ? n - 1 : next;
}

// Total-least-squares line through `count` points from i in direction `step`,
// oriented along the chain's travel.
export function fitLeg(pts: ReadonlyArray<Vec2>, i: number, count: number, step: 1 | -1): Leg {
  return legOf(count, legLine(pts, i, count, step));
}

function legOf(count: number, line: LegLine): Leg {
  const { cx, cy, dx, dy, sxx, sxy, syy } = line;
  // Smallest eigenvalue of the scatter matrix = residual sum of squares.
  const residualSq = Math.max(0, (sxx + syy - hypot2(sxx - syy, 2 * sxy)) / 2);
  return { count, cx, cy, dx, dy, residualSq };
}

type LegLine = Omit<Leg, 'count' | 'residualSq'> & {
  readonly sxx: number;
  readonly sxy: number;
  readonly syy: number;
};

// The leg's line and scatter sums (the straightness test needs no residual).
function legLine(pts: ReadonlyArray<Vec2>, i: number, count: number, step: 1 | -1): LegLine {
  const n = pts.length;
  const start = ((i % n) + n) % n;
  let cx = 0;
  let cy = 0;
  for (let k = 0, j = start; k < count; k += 1, j = wrapStep(j, step, n)) {
    const p = pts[j] as Vec2;
    cx += p.x;
    cy += p.y;
  }
  cx /= count;
  cy /= count;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let k = 0, j = start; k < count; k += 1, j = wrapStep(j, step, n)) {
    const p = pts[j] as Vec2;
    const ex = p.x - cx;
    const ey = p.y - cy;
    sxx += ex * ex;
    sxy += ex * ey;
    syy += ey * ey;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  const first = pts[start] as Vec2;
  const last = pts[(((i + (count - 1) * step) % n) + n) % n] as Vec2;
  const travelX = (last.x - first.x) * step;
  const travelY = (last.y - first.y) * step;
  if (dx * travelX + dy * travelY < 0) {
    dx = -dx;
    dy = -dy;
  }
  return { cx, cy, dx, dy, sxx, sxy, syy };
}

export function growLeg(
  pts: ReadonlyArray<Vec2>,
  start: number,
  step: 1 | -1,
  limit: number,
  tolerance: LegTolerance,
): number {
  let count = Math.min(limit, 2);
  while (count < limit && straightLine(pts, start, count + 1, step, tolerance) !== null) {
    count += 1;
  }
  return count;
}
