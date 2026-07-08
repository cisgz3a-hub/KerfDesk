// Ink-boundary extraction for the contour (filled-outline) tracer.
//
// Walks the ink/paper interface of a binary mask on the pixel-CORNER lattice
// (pixel (px,py) occupies the unit square [px,px+1]×[py,py+1]), producing one
// closed loop per boundary: outer boundaries and hole boundaries come out as
// separate loops with opposite orientation, so even-odd filling downstream
// keeps holes hollow. Written from scratch against our own mask/Vec2 types —
// boundary following on a lattice is textbook material (Pavlidis 1982).

import type { Vec2 } from '../scene';
import type { InkMask } from './centerline';

export type BoundaryLoop = {
  /** Closed staircase of lattice-corner points; last point ≠ first. */
  readonly points: ReadonlyArray<Vec2>;
  /** Signed shoelace area in px²; sign encodes orientation (holes oppose). */
  readonly area: number;
};

// Directions are indexed E,S,W,N; each boundary edge travels with ink on its
// RIGHT in screen coordinates (y down), so outer loops run counter-clockwise
// on screen and hole loops clockwise.
const DIR_X = [1, 0, -1, 0] as const;
const DIR_Y = [0, 1, 0, -1] as const;

/** Extract every closed ink-boundary loop of the mask. */
export function traceBoundaryLoops(mask: InkMask): BoundaryLoop[] {
  const edges = collectBoundaryEdges(mask);
  const loops: BoundaryLoop[] = [];
  for (const [start, dirs] of edges) {
    while (dirs.size > 0) {
      const firstDir = dirs.values().next().value;
      if (firstDir === undefined) break;
      loops.push(walkLoop(mask, edges, start, firstDir));
    }
  }
  return loops;
}

/** Midpoints of consecutive staircase edges — the dense "mid-crack" chain the
 *  curve-finishing stages consume. Halves the staircase amplitude and turns
 *  lattice corners into ≤45° bends, so curvature smoothing is not fooled
 *  into pinning every vertex as a hard turn. */
export function midCrackChain(loop: ReadonlyArray<Vec2>): Vec2[] {
  const n = loop.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = loop[i] as Vec2;
    const b = loop[(i + 1) % n] as Vec2;
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return out;
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

function walkLoop(mask: InkMask, edges: EdgeMap, startKey: number, startDir: number): BoundaryLoop {
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
    dir = nextDirection(edges, key, dir);
  } while (!(key === startKey && dir === startDir) && dir !== -1);
  return { points, area: area / 2 };
}

// At almost every corner exactly one out-edge remains. Two remain only at a
// "saddle" (two diagonally-touching ink pixels): prefer the RIGHT turn, which
// hugs the ink we are already tracing and keeps diagonal blobs as separate
// loops instead of welding them through the corner.
function nextDirection(edges: EdgeMap, key: number, incomingDir: number): number {
  const set = edges.get(key);
  if (set === undefined || set.size === 0) return -1;
  const right = (incomingDir + 1) % 4;
  if (set.has(right)) return right;
  if (set.has(incomingDir)) return incomingDir;
  const left = (incomingDir + 3) % 4;
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
