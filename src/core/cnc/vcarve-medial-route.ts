import type { Polyline } from '../scene';
import type { VCarveMedialGraph, VCarveMedialNode } from './vcarve-medial-axis';
import type { VCarveBoundarySegment, VCarveMedialRegion } from './vcarve-medial-region';
import { simplifyVCarveMedialWalk } from './vcarve-medial-route-simplify';

/** One deterministic, component-continuous edge-cover walk per graph component. */
export function vcarveMedialRoutes(
  graph: VCarveMedialGraph,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
  simplifyToleranceMm: number,
  sweepToleranceMm = simplifyToleranceMm,
  clearanceCapMm = Number.POSITIVE_INFINITY,
): ReadonlyArray<Polyline> {
  return graphComponents(graph).flatMap((component) => {
    const walk = edgeCoverWalk(graph, component);
    if (walk.length === 0) return [];
    const simplified = simplifyVCarveMedialWalk(
      walk.map((nodeIndex) => ({ ...requiredNode(graph, nodeIndex), nodeIndex })),
      graph,
      region,
      segments,
      simplifyToleranceMm,
      sweepToleranceMm,
      clearanceCapMm,
    );
    return [
      {
        points: simplified.map(({ x, y }) => ({ x, y })),
        closed: simplified.length > 1 && simplified[0]?.nodeIndex === simplified.at(-1)?.nodeIndex,
      },
    ];
  });
}

function graphComponents(graph: VCarveMedialGraph): ReadonlyArray<ReadonlyArray<number>> {
  const visited = new Set<number>();
  const components: number[][] = [];
  for (let start = 0; start < graph.nodes.length; start += 1) {
    if (visited.has(start)) continue;
    const component: number[] = [];
    const pending = [start];
    visited.add(start);
    while (pending.length > 0) {
      const node = pending.pop();
      if (node === undefined) continue;
      component.push(node);
      for (const neighbor of graph.adjacency[node] ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
    }
    component.sort((a, b) => compareNodes(graph.nodes[a], graph.nodes[b]));
    components.push(component);
  }
  return components.sort((a, b) => {
    const aIndex = a[0];
    const bIndex = b[0];
    return compareNodes(
      aIndex === undefined ? undefined : graph.nodes[aIndex],
      bIndex === undefined ? undefined : graph.nodes[bIndex],
    );
  });
}

function edgeCoverWalk(
  graph: VCarveMedialGraph,
  component: ReadonlyArray<number>,
): ReadonlyArray<number> {
  const start = component.reduce((best, candidate) => {
    const a = requiredNode(graph, candidate);
    const b = requiredNode(graph, best);
    return a.clearanceMm < b.clearanceMm ||
      (a.clearanceMm === b.clearanceMm && compareNodes(a, b) < 0)
      ? candidate
      : best;
  }, component[0] ?? 0);
  if (component.length === 1 && (graph.adjacency[start]?.length ?? 0) === 0) return [start];

  const visitedEdges = new Set<string>();
  const walk: number[] = [start];
  const stack: Array<{
    readonly node: number;
    readonly neighbors: ReadonlyArray<number>;
    nextNeighbor: number;
  }> = [{ node: start, neighbors: orderedNeighbors(graph, start), nextNeighbor: 0 }];
  while (stack.length > 0) {
    const frame = stack.at(-1);
    if (frame === undefined) break;
    const neighbor = frame.neighbors[frame.nextNeighbor];
    if (neighbor === undefined) {
      stack.pop();
      const parent = stack.at(-1);
      if (parent !== undefined) walk.push(parent.node);
      continue;
    }
    frame.nextNeighbor += 1;
    const key = edgeKey(frame.node, neighbor);
    if (visitedEdges.has(key)) continue;
    visitedEdges.add(key);
    walk.push(neighbor);
    stack.push({
      node: neighbor,
      neighbors: orderedNeighbors(graph, neighbor),
      nextNeighbor: 0,
    });
  }
  return walk;
}

function orderedNeighbors(graph: VCarveMedialGraph, node: number): ReadonlyArray<number> {
  return [...(graph.adjacency[node] ?? [])].sort((a, b) =>
    compareNodes(graph.nodes[a], graph.nodes[b]),
  );
}

function compareNodes(a: VCarveMedialNode | undefined, b: VCarveMedialNode | undefined): number {
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  return a.x - b.x || a.y - b.y || a.clearanceMm - b.clearanceMm;
}

function requiredNode(graph: VCarveMedialGraph, index: number): VCarveMedialNode {
  const node = graph.nodes[index];
  if (node === undefined) throw new Error(`Missing V-carve medial node ${index}.`);
  return node;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
