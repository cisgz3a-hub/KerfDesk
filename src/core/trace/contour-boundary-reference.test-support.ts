// FROZEN reference copy of the Map/Set boundary walker as of 952fb13e3
// (ADR-438 amendment, speed wave 2). Test support only: the direction-bit
// walker in contour-boundary.ts must return the same loops (points, area and
// order) on every mask. Do not edit or optimise this copy.

import type { Vec2 } from '../scene';
import type { InkMask } from './centerline';
import type { BoundaryLoop } from './contour-boundary';
import { CONNECT_PAPER_AT_SADDLES, type SaddleResolver } from './saddle-connectivity';

const DIR_X = [1, 0, -1, 0] as const;
const DIR_Y = [0, 1, 0, -1] as const;

export function referenceTraceBoundaryLoops(
  mask: InkMask,
  saddles: SaddleResolver = CONNECT_PAPER_AT_SADDLES,
): BoundaryLoop[] {
  const edges = collectBoundaryEdges(mask);
  const loops: BoundaryLoop[] = [];
  for (const [start, dirs] of edges) {
    while (dirs.size > 0) {
      const firstDir = dirs.values().next().value;
      if (firstDir === undefined) break;
      loops.push(walkLoop(mask, edges, start, firstDir, saddles));
    }
  }
  return loops;
}

type EdgeMap = Map<number, Set<number>>;

function collectBoundaryEdges(mask: InkMask): EdgeMap {
  const { width, height } = mask;
  const edges: EdgeMap = new Map();
  const stride = width + 1;
  const add = (x: number, y: number, dir: number): void => {
    const key = y * stride + x;
    const set = edges.get(key);
    if (set === undefined) edges.set(key, new Set([dir]));
    else set.add(dir);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (inkAt(mask, x, y) === 0) continue;
      // One directed lattice edge per exposed pixel side, ink on the right.
      if (inkAt(mask, x, y - 1) === 0) add(x, y, 0); // top side, travel E
      if (inkAt(mask, x + 1, y) === 0) add(x + 1, y, 1); // right side, travel S
      if (inkAt(mask, x, y + 1) === 0) add(x + 1, y + 1, 2); // bottom, travel W
      if (inkAt(mask, x - 1, y) === 0) add(x, y + 1, 3); // left side, travel N
    }
  }
  return edges;
}

function walkLoop(
  mask: InkMask,
  edges: EdgeMap,
  startKey: number,
  startDir: number,
  saddles: SaddleResolver,
): BoundaryLoop {
  const stride = mask.width + 1;
  const points: Vec2[] = [];
  let area = 0;
  let key = startKey;
  let dir = startDir;
  do {
    consumeEdge(edges, key, dir);
    const x = key % stride;
    const y = (key - x) / stride;
    const nx = x + (DIR_X[dir] as number);
    const ny = y + (DIR_Y[dir] as number);
    points.push({ x, y });
    // Shoelace accumulates over the directed edge (x,y)→(nx,ny).
    area += x * ny - nx * y;
    key = ny * stride + nx;
    dir = nextDirection(edges, key, dir, saddles, stride);
  } while (!(key === startKey && dir === startDir) && dir !== -1);
  return { points, area: area / 2 };
}

// At almost every corner exactly one out-edge remains. Two remain only at a
// "saddle" (two diagonally-touching ink pixels), and they are then the right
// and the left turn. The RIGHT turn hugs the ink already being traced and
// splits the diagonal pair (paper joins); the LEFT turn crosses the corner
// onto the other ink pixel (ink joins). Both passes through a saddle ask the
// same resolver, so the pairing of in- and out-edges is always consistent:
// the loops touch at the corner point but never cross, and the mid-crack
// chains stay ~0.71px apart there.
function nextDirection(
  edges: EdgeMap,
  key: number,
  incomingDir: number,
  saddles: SaddleResolver,
  stride: number,
): number {
  const set = edges.get(key);
  if (set === undefined || set.size === 0) return -1;
  const right = (incomingDir + 1) % 4;
  const left = (incomingDir + 3) % 4;
  if (set.has(right) && set.has(left)) {
    const x = key % stride;
    return saddles(x, (key - x) / stride) ? left : right;
  }
  if (set.has(right)) return right;
  if (set.has(incomingDir)) return incomingDir;
  if (set.has(left)) return left;
  return -1;
}

function consumeEdge(edges: EdgeMap, key: number, dir: number): void {
  const set = edges.get(key);
  if (set === undefined) return;
  set.delete(dir);
  if (set.size === 0) edges.delete(key);
}

function inkAt(mask: InkMask, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  return mask.ink[y * mask.width + x] ?? 0;
}
