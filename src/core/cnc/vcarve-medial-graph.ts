import type { Vec2 } from '../scene';

export type VCarveMedialNode = Vec2 & { readonly clearanceMm: number };

export type VCarveMedialGraph = {
  readonly nodes: ReadonlyArray<VCarveMedialNode>;
  readonly adjacency: ReadonlyArray<ReadonlyArray<number>>;
};

export type MutableVCarveMedialGraph = {
  readonly nodes: VCarveMedialNode[];
  readonly adjacency: Array<Set<number>>;
  cornerLimited: boolean;
};

type RankedGraph = {
  readonly graph: VCarveMedialGraph;
  readonly resolutionMm: number;
};

export function vcarveMedialGraphNeedsRefinement(
  graph: VCarveMedialGraph,
  resolutionMm: number,
): boolean {
  if (graph.nodes.length === 0 || medialGraphComponentCount(graph) !== 1) return true;
  const maximumClearanceMm = Math.max(...graph.nodes.map((node) => node.clearanceMm));
  return resolutionMm > maximumClearanceMm * 2;
}

export function betterVCarveMedialGraph(
  current: RankedGraph | null,
  candidate: VCarveMedialGraph,
  resolutionMm: number,
): RankedGraph {
  if (current === null) return { graph: candidate, resolutionMm };
  const candidateComponents = medialGraphComponentCount(candidate) || Number.POSITIVE_INFINITY;
  const currentComponents = medialGraphComponentCount(current.graph) || Number.POSITIVE_INFINITY;
  if (candidateComponents < currentComponents) return { graph: candidate, resolutionMm };
  if (candidateComponents > currentComponents) return current;
  return maximumClearance(candidate) > maximumClearance(current.graph)
    ? { graph: candidate, resolutionMm }
    : current;
}

export function finalizeVCarveMedialGraph(graph: MutableVCarveMedialGraph): VCarveMedialGraph {
  const hasEdges = graph.adjacency.some((neighbors) => neighbors.size > 0);
  let keep = graph.nodes
    .map((_, index) => index)
    .filter((index) => !hasEdges || graph.adjacency[index]?.size);
  if (!hasEdges && graph.nodes.length > 0) keep = [deepestNodeIndex(graph.nodes)];
  const remap = new Int32Array(graph.nodes.length).fill(-1);
  keep.forEach((oldIndex, newIndex) => {
    remap[oldIndex] = newIndex;
  });
  return {
    nodes: keep.flatMap((index) => {
      const node = graph.nodes[index];
      return node === undefined ? [] : [node];
    }),
    adjacency: keep.map((index) =>
      [...(graph.adjacency[index] ?? [])]
        .map((neighbor) => remap[neighbor] ?? -1)
        .filter((neighbor) => neighbor >= 0)
        .sort((a, b) => a - b),
    ),
  };
}

function medialGraphComponentCount(graph: VCarveMedialGraph): number {
  const visited = new Set<number>();
  let components = 0;
  for (let start = 0; start < graph.nodes.length; start += 1) {
    if (visited.has(start)) continue;
    components += 1;
    visitComponent(graph, start, visited);
  }
  return components;
}

function visitComponent(graph: VCarveMedialGraph, start: number, visited: Set<number>): void {
  const pending = [start];
  visited.add(start);
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    for (const neighbor of graph.adjacency[node] ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      pending.push(neighbor);
    }
  }
}

function maximumClearance(graph: VCarveMedialGraph): number {
  return graph.nodes.reduce((maximum, node) => Math.max(maximum, node.clearanceMm), 0);
}

function deepestNodeIndex(nodes: ReadonlyArray<VCarveMedialNode>): number {
  return nodes.reduce(
    (best, node, index) => (node.clearanceMm > (nodes[best]?.clearanceMm ?? -1) ? index : best),
    0,
  );
}
