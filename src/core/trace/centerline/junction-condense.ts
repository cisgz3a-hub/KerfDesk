// Junction condensation. Inside a FAT crossing (several strokes overlapping)
// thinning produces a nest of junction clusters a few pixels apart, connected
// by short corridor chains — the source of the "tangle at every crossing"
// defect. Junction nodes closer together than their combined stroke radii
// are one PHYSICAL crossing, so merge them into a single node: incident
// chains re-anchor to the merged centroid and the tiny connector chains
// between merged nodes disappear.

import type { Vec2 } from '../../scene';
import { arcLength } from './spur-pruning';
import type { StrokeChain, StrokeGraph, StrokeNode } from './stroke-graph';

const MERGE_RADIUS_FACTOR = 0.9;
const MERGE_MIN_DISTANCE_PX = 3;

export function condenseJunctions(
  graph: StrokeGraph,
  distSq: Float64Array,
  width: number,
): StrokeGraph {
  const junctions = graph.nodes.filter((n) => n.kind === 'junction');
  if (junctions.length < 2) return graph;
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let root = id;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    parent.set(id, root);
    return root;
  };
  for (let i = 0; i < junctions.length; i += 1) {
    for (let j = i + 1; j < junctions.length; j += 1) {
      const a = junctions[i];
      const b = junctions[j];
      if (a === undefined || b === undefined) continue;
      if (shouldMerge(a, b, distSq, width)) {
        const ra = find(a.id);
        const rb = find(b.id);
        if (ra !== rb) parent.set(ra, rb);
      }
    }
  }
  const merged = new Map<number, number>();
  for (const node of graph.nodes) merged.set(node.id, node.kind === 'junction' ? find(node.id) : node.id);
  if ([...merged.entries()].every(([id, root]) => id === root)) return graph;
  return rebuildGraph(graph, merged);
}

function shouldMerge(a: StrokeNode, b: StrokeNode, distSq: Float64Array, width: number): boolean {
  const distance = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
  const budget = Math.max(
    MERGE_MIN_DISTANCE_PX,
    MERGE_RADIUS_FACTOR * (radiusNear(a.pos, distSq, width) + radiusNear(b.pos, distSq, width)),
  );
  return distance <= budget;
}

function radiusNear(p: Vec2, distSq: Float64Array, width: number): number {
  const x = Math.max(0, Math.round(p.x - 0.5));
  const y = Math.max(0, Math.round(p.y - 0.5));
  return Math.sqrt(distSq[y * width + x] ?? 0);
}

function rebuildGraph(graph: StrokeGraph, merged: Map<number, number>): StrokeGraph {
  const { nodes, remap } = mergeNodeGroups(graph, merged);
  const chains: StrokeChain[] = [];
  for (const chain of graph.chains) {
    if (chain.closed) {
      chains.push(chain);
      continue;
    }
    const a = remap.get(chain.a) ?? chain.a;
    const b = remap.get(chain.b) ?? chain.b;
    // Connector chains INSIDE a merged crossing vanish — but only chains the
    // MERGE turned into self-loops (two distinct nodes collapsing into one).
    // A chain that was self-anchored all along is a drawn loop (a cursive
    // eyelet) and must survive no matter what merged elsewhere in the image.
    const mergedIntoSelfLoop = chain.a !== chain.b && a === b;
    if (mergedIntoSelfLoop && arcLength(chain.points) < connectorBudget(nodes[a])) continue;
    chains.push({ a, b, points: reanchorPoints(chain.points, nodes[a], nodes[b]), closed: false });
  }
  return { nodes, chains };
}

// Group nodes by merged root; each group becomes one node at the group
// centroid, junction kind winning over endpoint.
function mergeNodeGroups(
  graph: StrokeGraph,
  merged: Map<number, number>,
): { nodes: StrokeNode[]; remap: Map<number, number> } {
  const groups = new Map<number, StrokeNode[]>();
  for (const node of graph.nodes) {
    const root = merged.get(node.id) ?? node.id;
    const list = groups.get(root) ?? [];
    list.push(node);
    groups.set(root, list);
  }
  const nodes: StrokeNode[] = [];
  const remap = new Map<number, number>();
  for (const [, members] of groups) {
    const id = nodes.length;
    const pixels = members.flatMap((m) => [...m.pixels]);
    const kind = members.some((m) => m.kind === 'junction') ? 'junction' : members[0]?.kind;
    nodes.push({ id, pos: averagePosition(members), kind: kind ?? 'endpoint', pixels });
    for (const m of members) remap.set(m.id, id);
  }
  return { nodes, remap };
}

function connectorBudget(node: StrokeNode | undefined): number {
  return node === undefined ? 6 : 6 + node.pixels.length;
}

function averagePosition(members: ReadonlyArray<StrokeNode>): Vec2 {
  let sx = 0;
  let sy = 0;
  for (const m of members) {
    sx += m.pos.x;
    sy += m.pos.y;
  }
  const n = Math.max(1, members.length);
  return { x: sx / n, y: sy / n };
}

// Chains previously ended at their ORIGINAL node centroids; move the first
// and last points onto the merged centroids so junction pairing sees every
// incident chain meeting at exactly one shared point.
function reanchorPoints(
  points: ReadonlyArray<Vec2>,
  a: StrokeNode | undefined,
  b: StrokeNode | undefined,
): Vec2[] {
  const out = [...points];
  if (a !== undefined && out.length > 0) out[0] = a.pos;
  if (b !== undefined && out.length > 1) out[out.length - 1] = b.pos;
  return out;
}
