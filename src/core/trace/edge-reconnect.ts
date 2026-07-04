// Ridge-following reconnection for edge traces. Hysteresis drops edge
// stretches whose gradient dips below the low threshold — soft anti-aliased
// serif tops, letter terminals, rescaled/recompressed art — leaving lines
// that visibly should continue but end mid-air, further apart than any
// blind bridge may reach. The gradient RIDGE still runs through those gaps
// at reduced magnitude, so an open end can follow it: walk the non-max-
// suppressed magnitude field along the end's tangent (cone-limited, floor-
// gated so the walk dies on real blank paper) until another polyline is
// reached, then merge / close / T-join. No edge ridge, no reconnection —
// this never invents geometry.

import type { Polyline, Vec2 } from '../scene';
import { SegmentGrid } from './centerline/spatial-grid';

export type RidgeField = {
  readonly ridgeMag: Float32Array;
  readonly lowThreshold: number;
  readonly width: number;
  readonly height: number;
};

type OpenChain = { points: Vec2[]; closed: boolean };

const STEP_PX = 0.75;
const CONE_CURRENT_MIN_DOT = 0.5;
const CONE_INITIAL_MIN_DOT = Math.cos((50 * Math.PI) / 180);
// The ridge may sag well below the hysteresis low threshold in a dropout —
// but must stay clearly above noise.
const RIDGE_FLOOR_RATIO = 0.35;
const ARRIVE_DISTANCE_PX = 1.3;
const TANGENT_SPAN_PX = 3;
const DIRECTIONS = 16;

/** Reconnect open ends across sub-threshold ridge gaps. Mutates/merges the
 *  polyline list and returns it. `maxWalkPx` bounds each walk. */
export function reconnectAlongRidge(
  polylines: Polyline[],
  field: RidgeField,
  maxWalkPx: number,
): Polyline[] {
  if (maxWalkPx <= 0) return polylines;
  const chains: OpenChain[] = polylines.map((pl) => ({
    points: [...pl.points],
    closed: pl.closed,
  }));
  let guard = chains.length * 4 + 16;
  let madeProgress = true;
  while (madeProgress && guard > 0) {
    guard -= 1;
    madeProgress = false;
    // The grid indexes every chain's segments by chain index. It stays valid
    // for the whole pass: the first successful attach `break`s out and the
    // next pass rebuilds. Any chain the grid omits near a walk point cannot
    // be within ARRIVE_DISTANCE_PX, so it could never have been an arrival.
    const grid = buildArrivalGrid(chains);
    for (const chain of chains) {
      if (chain.closed || chain.points.length < 2) continue;
      if (tryReconnectEnd(chain, 'end', chains, grid, field, maxWalkPx)) {
        madeProgress = true;
        break;
      }
      if (tryReconnectEnd(chain, 'start', chains, grid, field, maxWalkPx)) {
        madeProgress = true;
        break;
      }
    }
  }
  return chains
    .filter((c) => c.points.length >= 2)
    .map((c) => ({ points: c.points, closed: c.closed }));
}

function tryReconnectEnd(
  chain: OpenChain,
  which: 'start' | 'end',
  chains: OpenChain[],
  grid: ArrivalGrid,
  field: RidgeField,
  maxWalkPx: number,
): boolean {
  if (which === 'start') chain.points.reverse();
  const connected = walkAndAttach(chain, chains, grid, field, maxWalkPx);
  if (which === 'start' && !chain.closed) chain.points.reverse();
  return connected;
}

// Walk from the chain's LAST point along the ridge; on arrival, attach.
function walkAndAttach(
  chain: OpenChain,
  chains: OpenChain[],
  grid: ArrivalGrid,
  field: RidgeField,
  maxWalkPx: number,
): boolean {
  const pts = chain.points;
  const end = pts.at(-1);
  const anchor = pointAtArcFromEnd(pts, TANGENT_SPAN_PX);
  if (end === undefined || anchor === undefined) return false;
  const dir0 = unit(end.x - anchor.x, end.y - anchor.y);
  if (dir0 === null) return false;
  const floor = field.lowThreshold * RIDGE_FLOOR_RATIO;
  const walked: Vec2[] = [];
  let cur = end;
  let dir = dir0;
  const maxSteps = Math.ceil(maxWalkPx / STEP_PX);
  for (let step = 0; step < maxSteps; step += 1) {
    const next = bestRidgeStep(cur, dir, dir0, field, floor);
    if (next === null) return false; // ridge died — genuine end
    walked.push(next);
    const hit = findArrival(chain, chains, grid, next);
    if (hit !== null) {
      attach(chain, walked, hit);
      return true;
    }
    const stepped = unit(next.x - cur.x, next.y - cur.y);
    if (stepped !== null) dir = unit(dir.x + stepped.x, dir.y + stepped.y) ?? dir;
    cur = next;
  }
  return false;
}

type Arrival =
  | { readonly kind: 'self-close' }
  | { readonly kind: 'other'; readonly chain: OpenChain; readonly atStart: boolean }
  | { readonly kind: 'mid'; readonly chain: OpenChain };

// A segment grid over every chain, tagged by chain index, so arrival tests
// examine only the chains whose geometry lies near the walk point instead of
// re-scanning every chain's every segment on each step.
type ArrivalGrid = { readonly grid: SegmentGrid; readonly indexOf: Map<OpenChain, number> };

function buildArrivalGrid(chains: ReadonlyArray<OpenChain>): ArrivalGrid {
  const grid = new SegmentGrid(ARRIVE_DISTANCE_PX);
  const indexOf = new Map<OpenChain, number>();
  for (let ci = 0; ci < chains.length; ci += 1) {
    const chain = chains[ci];
    if (chain === undefined) continue;
    indexOf.set(chain, ci);
    if (chain.points.length < 2) continue;
    const pts = chain.points;
    const count = pts.length + (chain.closed ? 0 : -1);
    for (let i = 0; i < count; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a === undefined || b === undefined) continue;
      grid.insert({ ownerId: ci, segIndex: i, a, b });
    }
  }
  return { grid, indexOf };
}

function findArrival(
  own: OpenChain,
  chains: ReadonlyArray<OpenChain>,
  arrival: ArrivalGrid,
  p: Vec2,
): Arrival | null {
  const ownStart = own.points[0];
  if (ownStart !== undefined && distance(p, ownStart) <= ARRIVE_DISTANCE_PX) {
    return { kind: 'self-close' };
  }
  // Evaluate candidate chains in original array order (the naive loop returned
  // the FIRST matching chain): collect nearby owner indices, then sort.
  const owners = new Set<number>();
  for (const seg of arrival.grid.query(p, ARRIVE_DISTANCE_PX)) owners.add(seg.ownerId);
  const ownIndex = arrival.indexOf.get(own);
  const sorted = [...owners].sort((a, b) => a - b);
  for (const ci of sorted) {
    if (ci === ownIndex) continue;
    const other = chains[ci];
    if (other === undefined || other === own || other.points.length < 2) continue;
    const hit = arrivalOnChain(other, p);
    if (hit !== null) return hit;
  }
  return null;
}

function arrivalOnChain(other: OpenChain, p: Vec2): Arrival | null {
  const first = other.points[0];
  const last = other.points.at(-1);
  if (!other.closed && first !== undefined && distance(p, first) <= ARRIVE_DISTANCE_PX) {
    return { kind: 'other', chain: other, atStart: true };
  }
  if (!other.closed && last !== undefined && distance(p, last) <= ARRIVE_DISTANCE_PX) {
    return { kind: 'other', chain: other, atStart: false };
  }
  return nearAnySegment(p, other) ? { kind: 'mid', chain: other } : null;
}

function attach(own: OpenChain, walked: Vec2[], hit: Arrival): void {
  own.points.push(...walked);
  if (hit.kind === 'self-close') {
    own.closed = true;
    return;
  }
  if (hit.kind === 'mid') return; // T-join: the walk now touches the other line
  const other = hit.chain;
  const tail = hit.atStart ? other.points : [...other.points].reverse();
  own.points.push(...tail);
  other.points = [];
  other.closed = false;
}

function nearAnySegment(p: Vec2, chain: OpenChain): boolean {
  const pts = chain.points;
  const count = pts.length + (chain.closed ? 0 : -1);
  for (let i = 0; i < count; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a === undefined || b === undefined) continue;
    if (pointToSegment(p, a, b) <= ARRIVE_DISTANCE_PX) return true;
  }
  return false;
}

const STEP_DIRECTIONS: ReadonlyArray<Vec2> = Array.from({ length: DIRECTIONS }, (_, i) => {
  const a = (i / DIRECTIONS) * 2 * Math.PI;
  return { x: Math.cos(a), y: Math.sin(a) };
});

function bestRidgeStep(
  cur: Vec2,
  dir: Vec2,
  dir0: Vec2,
  field: RidgeField,
  floor: number,
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  for (const d of STEP_DIRECTIONS) {
    if (d.x * dir.x + d.y * dir.y < CONE_CURRENT_MIN_DOT) continue;
    const alignment = d.x * dir0.x + d.y * dir0.y;
    if (alignment < CONE_INITIAL_MIN_DOT) continue;
    const candidate = { x: cur.x + d.x * STEP_PX, y: cur.y + d.y * STEP_PX };
    const mag = ridgeAt(field, candidate);
    if (mag < floor) continue;
    const score = alignment + mag / (field.lowThreshold + 1e-9);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function ridgeAt(field: RidgeField, p: Vec2): number {
  const x = Math.min(Math.max(Math.round(p.x - 0.5), 0), field.width - 1);
  const y = Math.min(Math.max(Math.round(p.y - 0.5), 0), field.height - 1);
  return field.ridgeMag[y * field.width + x] ?? 0;
}

function pointAtArcFromEnd(pts: ReadonlyArray<Vec2>, arc: number): Vec2 | undefined {
  let cum = 0;
  for (let i = pts.length - 1; i > 0; i -= 1) {
    const a = pts[i];
    const b = pts[i - 1];
    if (a === undefined || b === undefined) break;
    cum += distance(a, b);
    if (cum >= arc) return b;
  }
  return pts[0];
}

function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function unit(x: number, y: number): Vec2 | null {
  const len = Math.hypot(x, y);
  return len < 1e-9 ? null : { x: x / len, y: y / len };
}
