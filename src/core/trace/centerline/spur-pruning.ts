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
import { runTraceSteps, type TraceSteps } from '../trace-steps';
import { PruningWorklist, type MutablePruneChain as MutableChain } from './pruning-worklist';

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

// Cap the protrusion budget at fat-stroke scale (as junction-condense caps its
// merge reach). The budget models "how far past the trunk a CORNER wedge can
// stick out" — bounded by the stroke width at that corner. When thin arms meet
// a FAT hub (a filled star: 45-px inner-radius blob, 35-px sharp spokes), the
// junction radius is the blob's, not the arm's, and radiusFactor·junctionRadius
// balloons to ~72 px — swallowing every real spoke. A corner wedge never
// protrudes this far; a 12-px+ protrusion is a stroke, so the cap keeps real
// spokes while corner spurs (protrusion ≲ 6 px) still prune.
const MAX_SPUR_BUDGET_PX = 12;

type OpenComponent = { size: number };
type PruneState = {
  readonly degree: Map<number, number>;
  readonly component: Map<MutableChain, OpenComponent>;
  readonly worklist: PruningWorklist;
};

export function pruneSpurs(
  graph: StrokeGraph,
  distSq: Float64Array,
  width: number,
  options: SpurPruneOptions = DEFAULT_SPUR_OPTIONS,
): StrokeGraph {
  return runTraceSteps(pruneSpursSteps(graph, distSq, width, options));
}

export function* pruneSpursSteps(
  graph: StrokeGraph,
  distSq: Float64Array,
  width: number,
  options: SpurPruneOptions = DEFAULT_SPUR_OPTIONS,
): TraceSteps<StrokeGraph> {
  const cooperate = yield;
  const chains: MutableChain[] = graph.chains.map((c) => ({
    a: c.a,
    b: c.b,
    points: [...c.points],
    closed: c.closed,
    alive: true,
  }));
  const nodeKind = new Map<number, StrokeNode['kind']>();
  for (const node of graph.nodes) nodeKind.set(node.id, node.kind);
  const state: PruneState = {
    degree: liveDegrees(chains),
    component: yield* liveComponentsSteps(chains),
    worklist: new PruningWorklist(chains),
  };

  let changed = true;
  while (changed) {
    if (cooperate) yield;
    changed = yield* pruneOneSpurSteps(state, nodeKind, distSq, width, options);
    if (!changed && (yield* dissolvePassthroughJunctionsSteps(chains, state, nodeKind))) {
      changed = true;
    }
  }

  return survivingGraph(graph, chains);
}

// Pruning changes node roles as well as edges. A former junction with one
// surviving arm is now a stroke tip; retaining its historical role suppresses
// cap extension. Remove unused nodes and keep ids aligned with array indices.
function survivingDegrees(chains: ReadonlyArray<MutableChain>): Map<number, number> {
  const degree = liveDegrees(chains);
  // A dissolved ring may still share its anchor with an open branch. Its
  // two incidences remain part of that junction even though the closed ring
  // no longer participates in spur removal or passthrough pairing.
  for (const chain of chains) {
    if (!chain.alive || !chain.closed) continue;
    if (chain.a >= 0) degree.set(chain.a, (degree.get(chain.a) ?? 0) + 1);
    if (chain.b >= 0) degree.set(chain.b, (degree.get(chain.b) ?? 0) + 1);
  }
  return degree;
}

function survivingGraph(graph: StrokeGraph, chains: ReadonlyArray<MutableChain>): StrokeGraph {
  const degree = survivingDegrees(chains);
  const remap = new Map<number, number>();
  const nodes: StrokeNode[] = [];
  for (const node of graph.nodes) {
    const incident = degree.get(node.id) ?? 0;
    if (incident === 0) continue;
    const id = nodes.length;
    remap.set(node.id, id);
    nodes.push({ ...node, id, kind: incident === 1 ? 'endpoint' : 'junction' });
  }
  return {
    nodes,
    seamJunctions:
      graph.seamJunctions ??
      graph.nodes.filter((node) => node.kind === 'junction').map((node) => node.pos),
    chains: chains
      .filter((chain) => chain.alive)
      .map((chain) => ({
        a: remap.get(chain.a) ?? chain.a,
        b: remap.get(chain.b) ?? chain.b,
        points: chain.points,
        closed: chain.closed,
      })),
  };
}

// Keep the original first-candidate ordering, with live counts after every
// removal. A stale component size would let all leaves of a small mark die.
function* pruneOneSpurSteps(
  state: PruneState,
  nodeKind: Map<number, StrokeNode['kind']>,
  distSq: Float64Array,
  width: number,
  options: SpurPruneOptions,
): TraceSteps<boolean> {
  const cooperate = yield;
  const { degree, component, worklist } = state;
  for (let chain = worklist.take(); chain !== undefined; chain = worklist.take()) {
    if (cooperate) yield;
    if (!chain.alive || chain.closed) continue;
    if (!isPrunableLeaf(chain, degree, nodeKind)) continue;
    const group = component.get(chain);
    if (group === undefined || group.size <= 1) continue; // last chain guard
    if (!isArtifactSpur(chain, degree, distSq, width, options)) continue;
    chain.alive = false;
    worklist.detach(chain);
    adjustDegree(degree, chain, -1);
    group.size -= 1;
    worklist.changedAt(chain.a);
    worklist.changedAt(chain.b);
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

// These operations cannot split the remaining open edges of a component:
// removing a leaf deletes only its tip, and degree-two dissolution replaces
// a corridor with one edge. A newly closed loop removes its two open edges.
// Therefore component identity is fixed, while its live size changes.
function* liveComponentsSteps(
  chains: ReadonlyArray<MutableChain>,
): TraceSteps<Map<MutableChain, OpenComponent>> {
  const cooperate = yield;
  const parent = new Map<number, number>();
  const find = (n: number): number => {
    let root = n;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    parent.set(n, root);
    return root;
  };
  let work = 0;
  for (const chain of chains) {
    if ((work++ & 63) === 0 && cooperate) yield;
    if (chain.closed) continue;
    const ra = find(chain.a);
    const rb = find(chain.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const components = new Map<number, OpenComponent>();
  const byChain = new Map<MutableChain, OpenComponent>();
  for (const chain of chains) {
    if ((work++ & 63) === 0 && cooperate) yield;
    if (chain.closed) continue;
    const key = find(chain.a);
    const group = components.get(key) ?? { size: 0 };
    group.size += 1;
    components.set(key, group);
    byChain.set(chain, group);
  }
  return byChain;
}

function adjustDegree(degree: Map<number, number>, chain: MutableChain, change: number): void {
  if (chain.closed) return;
  degree.set(chain.a, (degree.get(chain.a) ?? 0) + change);
  degree.set(chain.b, (degree.get(chain.b) ?? 0) + change);
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
  const budget = Math.min(
    MAX_SPUR_BUDGET_PX,
    Math.max(options.minSpurPx, options.radiusFactor * junctionRadius),
  );
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
function* dissolvePassthroughJunctionsSteps(
  chains: MutableChain[],
  state: PruneState,
  nodeKind: Map<number, StrokeNode['kind']>,
): TraceSteps<boolean> {
  const cooperate = yield;
  // Recreate insertion order from the current chains, as before. A cached
  // map's historic order can choose a different first node after merges.
  const degree = liveDegrees(chains);
  for (const [nodeId, d] of degree) {
    if (cooperate) yield;
    if (d !== 2 || nodeKind.get(nodeId) !== 'junction') continue;
    const incident = state.worklist.at(nodeId);
    const first = incident[0];
    const second = incident[1];
    if (first === undefined || second === undefined || first === second) continue;
    const affected = [first.a, first.b, second.a, second.b];
    state.worklist.detach(first);
    state.worklist.detach(second);
    adjustDegree(state.degree, first, -1);
    adjustDegree(state.degree, second, -1);
    mergeThroughNode(first, second, nodeId);
    state.worklist.attach(first);
    adjustDegree(state.degree, first, 1);
    const group = state.component.get(first);
    if (group !== undefined) group.size -= first.closed ? 2 : 1;
    for (const node of affected) state.worklist.changedAt(node);
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
    // Keep the anchor id: another surviving chain may branch from this ring.
  }
  second.alive = false;
}
