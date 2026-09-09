import type { Vec2 } from '../../scene';
import { segmentInsideInk } from './junction-support';
import { radiusAtPosition } from './polyline-window';
import { arcLength } from './spur-pruning';
import type { StrokeChain, StrokeGraph, StrokeNode } from './stroke-graph';

// Account for lattice uncertainty, not stroke width: displaced parallel
// branches do not become one crossing merely because their trunk is fat.
const MAX_ARM_RESIDUAL_PX = 0.8;
const MAX_MERGE_DISTANCE_PX = 12;
type Arm = { readonly point: Vec2; readonly normal: Vec2; readonly next: Vec2 };

export function sharedCrossing(
  members: ReadonlyArray<StrokeNode>,
  graph: StrokeGraph,
  distSq: Float64Array,
  width: number,
): Vec2 | null {
  if (!compactGroup(members, distSq, width)) return null;
  const arms = outgoingArms(members, graph, distSq, width);
  if (arms === null || arms.length < 3) return null;
  const crossing = intersectArmLines(arms);
  if (crossing === null) return null;
  if (!members.every((node) => withinJunctionReach(node, crossing, distSq, width))) return null;
  if (!arms.every((arm) => armSupportsCrossing(arm, crossing, distSq, width))) return null;
  return crossing;
}

function withinJunctionReach(
  node: StrokeNode,
  point: Vec2,
  distSq: Float64Array,
  width: number,
): boolean {
  const radius = Math.min(
    MAX_MERGE_DISTANCE_PX,
    Math.max(1.5, 2 * radiusAtPosition(node.pos, distSq, width)),
  );
  return Math.hypot(node.pos.x - point.x, node.pos.y - point.y) <= radius;
}

function compactGroup(
  members: ReadonlyArray<StrokeNode>,
  distSq: Float64Array,
  width: number,
): boolean {
  for (let i = 0; i < members.length; i += 1) {
    const a = members[i];
    if (a === undefined) continue;
    for (const b of members.slice(i + 1)) {
      const radius =
        radiusAtPosition(a.pos, distSq, width) + radiusAtPosition(b.pos, distSq, width);
      // The fitted crossing bounds each member's actual displacement below.
      // Opposite nodes of one star hub may be farther apart than that bound.
      const budget = Math.max(1.5, 0.9 * radius);
      if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) > budget) return false;
    }
  }
  return true;
}

function outgoingArms(
  members: ReadonlyArray<StrokeNode>,
  graph: StrokeGraph,
  distSq: Float64Array,
  width: number,
): Arm[] | null {
  const byId = new Map(members.map((n) => [n.id, n]));
  const arms: Arm[] = [];
  for (const chain of graph.chains) {
    if (chain.closed || byId.has(chain.a) === byId.has(chain.b)) continue;
    const fromStart = byId.has(chain.a);
    const node = byId.get(fromStart ? chain.a : chain.b);
    if (node === undefined) return null;
    const radius = radiusAtPosition(node.pos, distSq, width);
    const arm = outgoingArm(chain, fromStart, radius);
    if (arm === null) return null;
    arms.push(arm);
  }
  return arms;
}

function outgoingArm(chain: StrokeChain, fromStart: boolean, radius: number): Arm | null {
  const points = fromStart ? chain.points : [...chain.points].reverse();
  const length = arcLength(points);
  const start = Math.min(length / 2, 2 * radius);
  const a = sampleArc(points, start);
  const b = sampleArc(points, Math.min(length, start + Math.max(3, 2 * radius)));
  const next = points[1];
  if (a === undefined || b === undefined || next === undefined) return null;
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  if (span < 1) return null;
  return { point: a, normal: { x: (a.y - b.y) / span, y: (b.x - a.x) / span }, next };
}

function sampleArc(points: ReadonlyArray<Vec2>, distance: number): Vec2 | undefined {
  let remaining = distance;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length >= remaining && length > 0) {
      const t = remaining / length;
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
    remaining -= length;
  }
  return points.at(-1);
}

// Solve (sum n*n^T)p = sum n*(n.q), then check EVERY arm's residual.
function intersectArmLines(arms: ReadonlyArray<Arm>): Vec2 | null {
  let xx = 0;
  let xy = 0;
  let yy = 0;
  let bx = 0;
  let by = 0;
  for (const { point, normal: n } of arms) {
    const offset = n.x * point.x + n.y * point.y;
    xx += n.x * n.x;
    xy += n.x * n.y;
    yy += n.y * n.y;
    bx += n.x * offset;
    by += n.y * offset;
  }
  const determinant = xx * yy - xy * xy;
  if (determinant < 1e-8) return null;
  return { x: (bx * yy - by * xy) / determinant, y: (by * xx - bx * xy) / determinant };
}

function armSupportsCrossing(arm: Arm, p: Vec2, distSq: Float64Array, width: number): boolean {
  const residual = Math.abs(
    arm.normal.x * (p.x - arm.point.x) + arm.normal.y * (p.y - arm.point.y),
  );
  return residual <= MAX_ARM_RESIDUAL_PX && segmentInsideInk(p, arm.next, distSq, width);
}
