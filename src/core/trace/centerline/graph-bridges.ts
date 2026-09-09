import type { StrokeGraph } from './stroke-graph';

type Link = { readonly node: number; readonly chain: number };
type Frame = { readonly node: number; readonly parentChain: number; next: number };

/** Edges on a drawn cycle must survive condensation. Iterative low-link
 * traversal handles parallel edges without consuming the call stack. */
export function bridgeChains(graph: StrokeGraph): Set<number> {
  const adjacency = graphAdjacency(graph);
  const depth = new Map<number, number>();
  const low = new Map<number, number>();
  const bridges = new Set<number>();
  for (const node of adjacency.keys()) {
    if (depth.has(node)) continue;
    depth.set(node, depth.size);
    low.set(node, depth.get(node) ?? 0);
    visitComponent(adjacency, [{ node, parentChain: -1, next: 0 }], depth, low, bridges);
  }
  return bridges;
}

function graphAdjacency(graph: StrokeGraph): Map<number, Link[]> {
  const adjacency = new Map<number, Link[]>();
  graph.chains.forEach((chain, index) => {
    if (chain.closed) return;
    const a = adjacency.get(chain.a) ?? [];
    a.push({ node: chain.b, chain: index });
    adjacency.set(chain.a, a);
    const b = adjacency.get(chain.b) ?? [];
    b.push({ node: chain.a, chain: index });
    adjacency.set(chain.b, b);
  });
  return adjacency;
}

function visitComponent(
  adjacency: Map<number, Link[]>,
  stack: Frame[],
  depth: Map<number, number>,
  low: Map<number, number>,
  bridges: Set<number>,
): void {
  while (stack.length > 0) {
    const current = stack.at(-1);
    if (current === undefined) break;
    const next = adjacency.get(current.node)?.[current.next++];
    if (next === undefined) {
      stack.pop();
      finishNode(current, stack.at(-1), depth, low, bridges);
    } else if (next.chain !== current.parentChain) {
      visitNeighbour(current, next, stack, depth, low);
    }
  }
}

function visitNeighbour(
  current: Frame,
  next: Link,
  stack: Frame[],
  depth: Map<number, number>,
  low: Map<number, number>,
): void {
  const previousDepth = depth.get(next.node);
  if (previousDepth !== undefined) {
    low.set(current.node, Math.min(low.get(current.node) ?? 0, previousDepth));
    return;
  }
  const nextDepth = depth.size;
  depth.set(next.node, nextDepth);
  low.set(next.node, nextDepth);
  stack.push({ node: next.node, parentChain: next.chain, next: 0 });
}

function finishNode(
  current: Frame,
  parent: Frame | undefined,
  depth: Map<number, number>,
  low: Map<number, number>,
  bridges: Set<number>,
): void {
  if (parent === undefined) return;
  const childLow = low.get(current.node) ?? 0;
  if (childLow > (depth.get(parent.node) ?? 0)) bridges.add(current.parentChain);
  low.set(parent.node, Math.min(low.get(parent.node) ?? 0, childLow));
}
