// Collapse skeleton junctions only when they describe one shared crossing.
// Distance alone cannot distinguish a fat crossing from nearby independent
// intersections. Contracting only bridges preserves every existing graph cycle.

import type { Vec2 } from '../../scene';
import { bridgeChains } from './graph-bridges';
import { sharedCrossing } from './junction-contraction';
import { arcLength } from './spur-pruning';
import type { StrokeChain, StrokeGraph, StrokeNode } from './stroke-graph';

type Group = { readonly members: ReadonlyArray<StrokeNode>; readonly pos: Vec2 };

export function condenseJunctions(
  graph: StrokeGraph,
  distSq: Float64Array,
  width: number,
): StrokeGraph {
  const groups = new Map<number, Group>(
    graph.nodes.map((node) => [node.id, { members: [node], pos: node.pos }]),
  );
  const groupOf = new Map(graph.nodes.map((node) => [node.id, node.id]));
  const bridges = bridgeChains(graph);
  const loopAnchors = new Set(
    graph.chains.filter((chain) => chain.closed).flatMap((chain) => [chain.a, chain.b]),
  );
  const candidates = [...bridges]
    .filter((index) => {
      const chain = graph.chains[index];
      return chain !== undefined && !loopAnchors.has(chain.a) && !loopAnchors.has(chain.b);
    })
    .sort((a, b) => chainLength(graph, a) - chainLength(graph, b));
  let previousSize = 0;
  while (groups.size !== previousSize) {
    previousSize = groups.size;
    for (const index of candidates) {
      const chain = graph.chains[index];
      if (chain !== undefined) tryMerge(chain, groups, groupOf, graph, distSq, width);
    }
  }
  if (groups.size === graph.nodes.length) return graph;
  return rebuildGraph(graph, groups, groupOf, bridges);
}

function chainLength(graph: StrokeGraph, index: number): number {
  return arcLength(graph.chains[index]?.points ?? []);
}

function tryMerge(
  chain: StrokeChain,
  groups: Map<number, Group>,
  groupOf: Map<number, number>,
  graph: StrokeGraph,
  distSq: Float64Array,
  width: number,
): void {
  const aId = groupOf.get(chain.a);
  const bId = groupOf.get(chain.b);
  if (aId === undefined || bId === undefined || aId === bId) return;
  const a = groups.get(aId);
  const b = groups.get(bId);
  if (a === undefined || b === undefined) return;
  const members = [...a.members, ...b.members];
  if (members.some((node) => node.kind !== 'junction')) return;
  const pos = sharedCrossing(members, graph, distSq, width);
  if (pos === null) return;
  groups.set(aId, { members, pos });
  groups.delete(bId);
  for (const member of b.members) groupOf.set(member.id, aId);
}

function rebuildGraph(
  graph: StrokeGraph,
  groups: Map<number, Group>,
  groupOf: Map<number, number>,
  bridges: Set<number>,
): StrokeGraph {
  const nodes: StrokeNode[] = [];
  const remap = new Map<number, number>();
  for (const [groupId, group] of groups) {
    const id = nodes.length;
    remap.set(groupId, id);
    nodes.push({
      id,
      pos: group.pos,
      kind: group.members[0]?.kind ?? 'endpoint',
      pixels: group.members.flatMap((node) => [...node.pixels]),
    });
  }
  const chains: StrokeChain[] = [];
  graph.chains.forEach((chain, index) => {
    const a = remap.get(groupOf.get(chain.a) ?? chain.a) ?? chain.a;
    const b = remap.get(groupOf.get(chain.b) ?? chain.b) ?? chain.b;
    if (chain.closed) {
      chains.push({ ...chain, a, b });
      return;
    }
    if (chain.a !== chain.b && a === b && bridges.has(index)) return;
    chains.push({ ...chain, a, b, points: reanchorPoints(chain.points, nodes[a], nodes[b]) });
  });
  return { ...graph, nodes, chains };
}

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
