// Radius-aware spur pruning. A leaf chain (endpoint on one side, junction on
// the other) shorter than the stroke radius at its junction is a thinning
// artifact — the skeleton of a stroke CORNER, not a real stroke — and gets
// removed. Two hard guarantees fix the old implementation's defects:
//   1. A connected component's last chain is NEVER pruned (no vanished
//      strokes, ever).
//   2. After pruning, junctions left with exactly two chains DISSOLVE — the
//      two chains merge into one smooth through-path instead of leaving a
//      kink node behind.

import type { Vec2 } from '../../scene';
import type { StrokeGraph, StrokeNode } from './stroke-graph';

export type SpurPruneOptions = {
  /** Multiplier on the junction's local stroke radius. */
  readonly radiusFactor: number;
  /** Absolute floor: spurs shorter than this always go. */
  readonly minSpurPx: number;
  /** A leaf only counts as an artifact when its TIP pinches out — its local
   *  radius is at most this. Real branches keep their own stroke radius. */
  readonly maxSpurTipRadiusPx: number;
};

// Discriminating artifact spurs from real branches by LENGTH alone is
// impossible: the diagonal corner spur of a 16-px-radius band is 16·√2 ≈ 23px
// — the same length as a genuine short branch. The reliable signal is the
// TIP: corner/jaggy wedges pinch to ~1px of ink at their end, while a real
// branch ends in its own full-radius cap. Prune only pinched tips.
export const DEFAULT_SPUR_OPTIONS: SpurPruneOptions = {
  radiusFactor: 1.6,
  minSpurPx: 2,
  maxSpurTipRadiusPx: 1.6,
};

type MutableChain = {
  a: number;
  b: number;
  points: Vec2[];
  closed: boolean;
  alive: boolean;
};

export function pruneSpurs(
  graph: StrokeGraph,
  distSq: Float64Array,
  width: number,
  options: SpurPruneOptions = DEFAULT_SPUR_OPTIONS,
): StrokeGraph {
  const chains: MutableChain[] = graph.chains.map((c) => ({
    a: c.a,
    b: c.b,
    points: [...c.points],
    closed: c.closed,
    alive: true,
  }));
  const nodeKind = new Map<number, StrokeNode['kind']>();
  for (const node of graph.nodes) nodeKind.set(node.id, node.kind);

  let changed = true;
  while (changed) {
    changed = pruneOneSpur(chains, nodeKind, distSq, width, options);
    if (!changed && dissolvePassthroughJunctions(chains, nodeKind)) changed = true;
  }

  return {
    nodes: graph.nodes,
    chains: chains
      .filter((c) => c.alive)
      .map((c) => ({ a: c.a, b: c.b, points: c.points, closed: c.closed })),
  };
}

// One prune per sweep: degree and component counts go stale the moment a
// chain dies, and pruning further against the snapshot lets every leaf of a
// small mark die in a single pass — a 3-px "+" or a dot vanishes entirely,
// the exact last-chain violation the component guard exists to prevent.
function pruneOneSpur(
  chains: MutableChain[],
  nodeKind: Map<number, StrokeNode['kind']>,
  distSq: Float64Array,
  width: number,
  options: SpurPruneOptions,
): boolean {
  const degree = liveDegrees(chains);
  const componentSize = liveComponentChainCounts(chains);
  for (const chain of chains) {
    if (!chain.alive || chain.closed) continue;
    if (!isPrunableLeaf(chain, degree, nodeKind)) continue;
    if ((componentSize.get(componentKey(chain, chains)) ?? 1) <= 1) continue; // last chain guard
    if (!isArtifactSpur(chain, degree, distSq, width, options)) continue;
    chain.alive = false;
    return true;
  }
  return false;
}

function liveDegrees(chains: ReadonlyArray<MutableChain>): Map<number, number> {
  const degree = new Map<number, number>();
  for (const chain of chains) {
    if (!chain.alive || chain.closed) continue;
    degree.set(chain.a, (degree.get(chain.a) ?? 0) + 1);
    degree.set(chain.b, (degree.get(chain.b) ?? 0) + 1);
  }
  return degree;
}

// Union-find over node ids; every open chain links its two ends. Closed
// chains are their own components and never pruned.
function liveComponentChainCounts(chains: ReadonlyArray<MutableChain>): Map<string, number> {
  const parent = new Map<number, number>();
  const find = (n: number): number => {
    let root = n;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    parent.set(n, root);
    return root;
  };
  for (const chain of chains) {
    if (!chain.alive || chain.closed) continue;
    const ra = find(chain.a);
    const rb = find(chain.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const counts = new Map<string, number>();
  for (const chain of chains) {
    if (!chain.alive || chain.closed) continue;
    const key = `n${find(chain.a)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function componentKey(chain: MutableChain, chains: ReadonlyArray<MutableChain>): string {
  // Recompute the representative the same way liveComponentChainCounts does.
  const parent = new Map<number, number>();
  const find = (n: number): number => {
    let root = n;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    return root;
  };
  for (const c of chains) {
    if (!c.alive || c.closed) continue;
    const ra = find(c.a);
    const rb = find(c.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return `n${find(chain.a)}`;
}

// The pinched-tip discriminator. A leaf's arc length includes its run INSIDE
// the trunk (junction node to trunk edge ≈ one junction radius); only the
// protrusion beyond the trunk distinguishes a corner artifact / noise whisker
// from a real branch — and a real branch ends in its own full-radius cap.
function isArtifactSpur(
  chain: MutableChain,
  degree: Map<number, number>,
  distSq: Float64Array,
  width: number,
  options: SpurPruneOptions,
): boolean {
  const junctionEnd = leafJunctionEnd(chain, degree);
  if (junctionEnd === null) return false;
  const length = arcLength(chain.points);
  if (length < options.minSpurPx) return true;
  const tipRadius = radiusNearPoint(leafTipPos(chain, degree), distSq, width);
  if (tipRadius > options.maxSpurTipRadiusPx) return false; // real branch cap
  const junctionRadius = radiusNearPoint(junctionEnd.pos, distSq, width);
  const budget = Math.max(options.minSpurPx, options.radiusFactor * junctionRadius);
  return length - junctionRadius < budget;
}

function isPrunableLeaf(
  chain: MutableChain,
  degree: Map<number, number>,
  nodeKind: Map<number, StrokeNode['kind']>,
): boolean {
  const aLeaf = (degree.get(chain.a) ?? 0) === 1;
  const bLeaf = (degree.get(chain.b) ?? 0) === 1;
  if (aLeaf === bLeaf) return false; // isolated segment or internal chain
  const junction = aLeaf ? chain.b : chain.a;
  return (degree.get(junction) ?? 0) >= 3 || nodeKind.get(junction) === 'junction';
}

function leafJunctionEnd(
  chain: MutableChain,
  degree: Map<number, number>,
): { readonly pos: Vec2 } | null {
  const aLeaf = (degree.get(chain.a) ?? 0) === 1;
  const pos = aLeaf ? chain.points.at(-1) : chain.points[0];
  return pos === undefined ? null : { pos };
}

// The free (endpoint) end of a leaf chain — where a real branch keeps its cap.
function leafTipPos(chain: MutableChain, degree: Map<number, number>): Vec2 {
  const aLeaf = (degree.get(chain.a) ?? 0) === 1;
  const pos = aLeaf ? chain.points[0] : chain.points.at(-1);
  return pos ?? { x: 0, y: 0 };
}

function radiusNearPoint(p: Vec2, distSq: Float64Array, width: number): number {
  const x = Math.max(0, Math.round(p.x - 0.5));
  const y = Math.max(0, Math.round(p.y - 0.5));
  return Math.sqrt(distSq[y * width + x] ?? 0);
}

export function arcLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

// Merge the two surviving chains of any degree-2 node into one through-chain.
function dissolvePassthroughJunctions(
  chains: MutableChain[],
  nodeKind: Map<number, StrokeNode['kind']>,
): boolean {
  const degree = liveDegrees(chains);
  for (const [nodeId, d] of degree) {
    if (d !== 2 || nodeKind.get(nodeId) !== 'junction') continue;
    const incident = chains.filter(
      (c) => c.alive && !c.closed && (c.a === nodeId || c.b === nodeId),
    );
    const first = incident[0];
    const second = incident[1];
    if (first === undefined || second === undefined || first === second) continue;
    mergeThroughNode(first, second, nodeId);
    return true; // degrees changed — caller loops again
  }
  return false;
}

function mergeThroughNode(first: MutableChain, second: MutableChain, nodeId: number): void {
  // Orient both so `first` ends at the node and `second` starts at it.
  if (first.a === nodeId) {
    first.points.reverse();
    const t = first.a;
    first.a = first.b;
    first.b = t;
  }
  if (second.b === nodeId) {
    second.points.reverse();
    const t = second.a;
    second.a = second.b;
    second.b = t;
  }
  first.points.push(...second.points.slice(1)); // drop the duplicated node point
  first.b = second.b;
  if (first.a === first.b && first.points.length >= 4) {
    first.closed = true;
    first.points.pop(); // closed polylines don't repeat the start point
    first.a = -1;
    first.b = -1;
  }
  second.alive = false;
}
