// Skeleton pixels → explicit stroke graph. Junction pixel CLUSTERS collapse
// to single nodes (their centroid), chains are the degree-2 corridors between
// nodes, and pure cycles (letter O) become closed chains. Spur pruning is
// radius-aware — a leaf shorter than the local stroke radius at its junction
// is a thinning artifact, not a stroke — and can never delete the last chain
// of a connected component (the old implementation's vanished-stroke bug).

import type { Vec2 } from '../../scene';
import { ringConfig, ringNeighborCount } from './medial-thinning';

export type StrokeNodeKind = 'endpoint' | 'junction';

export type StrokeNode = {
  readonly id: number;
  readonly pos: Vec2;
  readonly kind: StrokeNodeKind;
  /** Skeleton pixel indices belonging to this node (junction cluster). */
  readonly pixels: ReadonlyArray<number>;
};

export type StrokeChain = {
  /** Node ids at each end; -1 for closed loops. */
  readonly a: number;
  readonly b: number;
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};

export type StrokeGraph = {
  readonly nodes: ReadonlyArray<StrokeNode>;
  readonly chains: ReadonlyArray<StrokeChain>;
};

const RING: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

export function buildStrokeGraph(skeleton: Uint8Array, width: number, height: number): StrokeGraph {
  const degree = new Uint8Array(skeleton.length);
  for (let i = 0; i < skeleton.length; i += 1) {
    if ((skeleton[i] ?? 0) === 1) {
      degree[i] = ringNeighborCount(ringConfig(skeleton, width, height, i));
    }
  }
  const nodeOfPixel = new Int32Array(skeleton.length).fill(-1);
  const nodes = collectNodes(skeleton, degree, nodeOfPixel, width, height);
  const chains = collectChains(skeleton, degree, nodeOfPixel, nodes, width, height);
  return { nodes, chains };
}

function collectNodes(
  skeleton: Uint8Array,
  degree: Uint8Array,
  nodeOfPixel: Int32Array,
  width: number,
  height: number,
): StrokeNode[] {
  const nodes: StrokeNode[] = [];
  for (let i = 0; i < skeleton.length; i += 1) {
    if ((skeleton[i] ?? 0) !== 1 || (nodeOfPixel[i] ?? -1) !== -1) continue;
    const d = degree[i] ?? 0;
    if (d === 1) {
      nodes.push(makeNode(nodes.length, [i], 'endpoint', width));
      nodeOfPixel[i] = nodes.length - 1;
      continue;
    }
    if (d >= 3) {
      // Flood the whole adjacent junction cluster into one node.
      const cluster = floodJunctionCluster(skeleton, degree, nodeOfPixel, width, height, i);
      nodes.push(makeNode(nodes.length, cluster, 'junction', width));
    }
  }
  return nodes;
}

function makeNode(
  id: number,
  pixels: ReadonlyArray<number>,
  kind: StrokeNodeKind,
  width: number,
): StrokeNode {
  let sx = 0;
  let sy = 0;
  for (const p of pixels) {
    sx += p % width;
    sy += (p - (p % width)) / width;
  }
  const n = Math.max(1, pixels.length);
  return { id, pos: { x: sx / n + 0.5, y: sy / n + 0.5 }, kind, pixels };
}

function floodJunctionCluster(
  skeleton: Uint8Array,
  degree: Uint8Array,
  nodeOfPixel: Int32Array,
  width: number,
  height: number,
  start: number,
): number[] {
  const cluster: number[] = [];
  const queue = [start];
  nodeOfPixel[start] = -2; // provisional mark; finalized below
  while (queue.length > 0) {
    const index = queue.pop();
    if (index === undefined) break;
    cluster.push(index);
    enqueueClusterNeighbours(skeleton, degree, nodeOfPixel, width, height, index, queue);
  }
  // Finalize: all cluster pixels point at the node id about to be assigned.
  return cluster;
}

function enqueueClusterNeighbours(
  skeleton: Uint8Array,
  degree: Uint8Array,
  nodeOfPixel: Int32Array,
  width: number,
  height: number,
  index: number,
  queue: number[],
): void {
  const x = index % width;
  const y = (index - x) / width;
  for (const [dx, dy] of RING) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const ni = ny * width + nx;
    if ((skeleton[ni] ?? 0) !== 1) continue;
    if ((degree[ni] ?? 0) < 3) continue;
    if ((nodeOfPixel[ni] ?? -1) !== -1) continue;
    nodeOfPixel[ni] = -2;
    queue.push(ni);
  }
}

function collectChains(
  skeleton: Uint8Array,
  degree: Uint8Array,
  nodeOfPixel: Int32Array,
  nodes: ReadonlyArray<StrokeNode>,
  width: number,
  height: number,
): StrokeChain[] {
  // Re-point provisional cluster marks at their node ids.
  for (const node of nodes) {
    for (const p of node.pixels) nodeOfPixel[p] = node.id;
  }
  const chains: StrokeChain[] = [];
  const visited = new Uint8Array(skeleton.length); // corridor pixels consumed
  const nodeLinks = new Set<string>(); // dedupe direct node-node adjacencies
  for (const node of nodes) {
    for (const p of node.pixels) {
      walkChainsFromNodePixel(
        { skeleton, degree, nodeOfPixel, nodes, width, height, visited, chains, nodeLinks },
        node,
        p,
      );
    }
  }
  collectLoops({ skeleton, degree, nodeOfPixel, width, height, visited, chains });
  return chains;
}

type WalkCtx = {
  readonly skeleton: Uint8Array;
  readonly degree: Uint8Array;
  readonly nodeOfPixel: Int32Array;
  readonly nodes: ReadonlyArray<StrokeNode>;
  readonly width: number;
  readonly height: number;
  readonly visited: Uint8Array;
  readonly chains: StrokeChain[];
  readonly nodeLinks: Set<string>;
};

function walkChainsFromNodePixel(ctx: WalkCtx, node: StrokeNode, pixel: number): void {
  const x = pixel % ctx.width;
  const y = (pixel - x) / ctx.width;
  for (const [dx, dy] of RING) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) continue;
    const ni = ny * ctx.width + nx;
    if ((ctx.skeleton[ni] ?? 0) !== 1) continue;
    const neighborNode = ctx.nodeOfPixel[ni] ?? -1;
    if (neighborNode >= 0) {
      recordDirectLink(ctx, node, neighborNode);
      continue;
    }
    if ((ctx.visited[ni] ?? 0) === 1) continue;
    traceCorridor(ctx, node, pixel, ni);
  }
}

function recordDirectLink(ctx: WalkCtx, node: StrokeNode, otherId: number): void {
  if (otherId === node.id) return;
  const key = node.id < otherId ? `${node.id}:${otherId}` : `${otherId}:${node.id}`;
  if (ctx.nodeLinks.has(key)) return;
  ctx.nodeLinks.add(key);
  const other = ctx.nodes[otherId];
  if (other === undefined) return;
  ctx.chains.push({ a: node.id, b: otherId, points: [node.pos, other.pos], closed: false });
}

function traceCorridor(
  ctx: WalkCtx,
  startNode: StrokeNode,
  fromPixel: number,
  first: number,
): void {
  const points: Vec2[] = [startNode.pos];
  let prev = fromPixel;
  let cur = first;
  for (;;) {
    ctx.visited[cur] = 1;
    points.push(pixelCenter(cur, ctx.width));
    const next = nextCorridorPixel(ctx, prev, cur);
    if (next === -1) {
      // Dead end without a node pixel — treat the last corridor pixel as an
      // implicit endpoint (can happen when thinning leaves a lone stub).
      ctx.chains.push({ a: startNode.id, b: startNode.id, points, closed: false });
      return;
    }
    const endNode = ctx.nodeOfPixel[next] ?? -1;
    if (endNode >= 0) {
      const end = ctx.nodes[endNode];
      if (end !== undefined) points.push(end.pos);
      ctx.chains.push({ a: startNode.id, b: endNode, points, closed: false });
      return;
    }
    if ((ctx.visited[next] ?? 0) === 1) return; // already consumed elsewhere
    prev = cur;
    cur = next;
  }
}

function nextCorridorPixel(ctx: WalkCtx, prev: number, cur: number): number {
  const x = cur % ctx.width;
  const y = (cur - x) / ctx.width;
  for (const [dx, dy] of RING) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) continue;
    const candidate = corridorCandidate(ctx, prev, ny * ctx.width + nx);
    if (candidate >= 0) return candidate;
  }
  return -1;
}

// A neighbour continues the corridor when it is unvisited skeleton, or ends
// it when it belongs to a node cluster. -1 means "not this neighbour".
function corridorCandidate(ctx: WalkCtx, prev: number, ni: number): number {
  if (ni === prev) return -1;
  if ((ctx.skeleton[ni] ?? 0) !== 1) return -1;
  if ((ctx.nodeOfPixel[ni] ?? -1) >= 0) return ni;
  if ((ctx.visited[ni] ?? 0) === 1) return -1;
  return ni;
}

type LoopCtx = {
  readonly skeleton: Uint8Array;
  readonly degree: Uint8Array;
  readonly nodeOfPixel: Int32Array;
  readonly width: number;
  readonly height: number;
  readonly visited: Uint8Array;
  readonly chains: StrokeChain[];
};

// Pure cycles have no node pixels at all — every pixel is degree 2.
function collectLoops(ctx: LoopCtx): void {
  for (let i = 0; i < ctx.skeleton.length; i += 1) {
    if ((ctx.skeleton[i] ?? 0) !== 1) continue;
    if ((ctx.visited[i] ?? 0) === 1) continue;
    if ((ctx.nodeOfPixel[i] ?? -1) >= 0) continue;
    const points: Vec2[] = [];
    let prev = -1;
    let cur = i;
    for (;;) {
      ctx.visited[cur] = 1;
      points.push(pixelCenter(cur, ctx.width));
      const next = nextLoopPixel(ctx, prev, cur);
      if (next === -1 || next === i) break;
      prev = cur;
      cur = next;
    }
    if (points.length >= 3) ctx.chains.push({ a: -1, b: -1, points, closed: true });
  }
}

function nextLoopPixel(ctx: LoopCtx, prev: number, cur: number): number {
  const x = cur % ctx.width;
  const y = (cur - x) / ctx.width;
  for (const [dx, dy] of RING) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) continue;
    const ni = ny * ctx.width + nx;
    if (ni === prev) continue;
    if ((ctx.skeleton[ni] ?? 0) !== 1) continue;
    if ((ctx.visited[ni] ?? 0) === 1) continue;
    return ni;
  }
  return -1;
}

function pixelCenter(index: number, width: number): Vec2 {
  const x = index % width;
  return { x: x + 0.5, y: (index - x) / width + 0.5 };
}
