// Checkerboard lattice recovery (ADR-106, v2.b): organize X-corner candidates
// into the ordered rows×cols inner-corner grid. Strategy: seed at a strong
// candidate near the cloud's centre, estimate the two local lattice basis
// vectors from its nearest neighbours, then breadth-first grow integer grid
// coordinates outward, predicting each next corner by locally extrapolating
// already-assigned neighbours (which tracks perspective and lens curvature).
// Pure core: deterministic, no I/O; failures are typed values, not throws.

import type { Vec2 } from '../scene';
import type { CornerCandidate } from './xcorner';

export type GridFailure = 'too-few-corners' | 'no-lattice' | 'grid-mismatch';

/** Inner-corner grid size the operator's printed board has (e.g. 9×6). */
export type CheckerboardSpec = {
  readonly rows: number;
  readonly cols: number;
};

export type GridResult =
  | { readonly kind: 'ok'; readonly corners: ReadonlyArray<Vec2> }
  | { readonly kind: 'failed'; readonly reason: GridFailure };

// Growth predicts the next corner and accepts the nearest unused candidate
// within this fraction of the local lattice spacing. Wide enough for fisheye
// curvature across one cell, narrow enough to reject off-lattice noise.
const PREDICT_TOLERANCE = 0.35;
// A basis pair must be reasonably orthogonal (|cos| below this) and of
// comparable length for the seed to count as a lattice interior corner.
const BASIS_MAX_ABS_COS = 0.7;
const BASIS_MAX_LENGTH_RATIO = 2;
// Consider at most this many strongest candidates per expected corner; keeps
// the O(n²) neighbour scans bounded and drops trailing noise responses.
const CANDIDATES_PER_CORNER = 2;

type GridKey = string;

type Lattice = {
  // "i,j" -> index into the candidates array.
  readonly cells: ReadonlyMap<GridKey, number>;
};

function key(i: number, j: number): GridKey {
  return `${i},${j}`;
}

/** Group candidates into the ordered `spec.rows`×`spec.cols` corner grid. */
export function groupIntoGrid(
  candidates: ReadonlyArray<CornerCandidate>,
  spec: CheckerboardSpec,
): GridResult {
  const needed = spec.rows * spec.cols;
  if (candidates.length < needed) return { kind: 'failed', reason: 'too-few-corners' };
  const pool = candidates.slice(0, needed * CANDIDATES_PER_CORNER);
  const seedBasis = chooseSeedBasis(pool);
  if (seedBasis === null) return { kind: 'failed', reason: 'no-lattice' };
  const lattice = growLattice(pool, seedBasis.seed, seedBasis.u, seedBasis.v);
  if (lattice.cells.size < needed) return { kind: 'failed', reason: 'grid-mismatch' };
  return extractOrderedWindow(pool, lattice, spec);
}

type SeedBasis = {
  readonly seed: number;
  readonly u: Vec2;
  readonly v: Vec2;
};

// Seed = the candidate nearest the pool centroid (interior corners have four
// lattice neighbours); basis = its nearest neighbour plus the nearest
// sufficiently-non-collinear, comparable-length neighbour.
function chooseSeedBasis(pool: ReadonlyArray<CornerCandidate>): SeedBasis | null {
  const centroid = poolCentroid(pool);
  let seed = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pool.length; i += 1) {
    const p = pool[i];
    if (p === undefined) continue;
    const d = Math.hypot(p.x - centroid.x, p.y - centroid.y);
    if (d < best) {
      best = d;
      seed = i;
    }
  }
  const basis = basisFromNeighbours(pool, seed);
  return basis === null ? null : { seed, u: basis.u, v: basis.v };
}

function poolCentroid(pool: ReadonlyArray<CornerCandidate>): Vec2 {
  let sx = 0;
  let sy = 0;
  for (const p of pool) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pool.length, y: sy / pool.length };
}

function basisFromNeighbours(
  pool: ReadonlyArray<CornerCandidate>,
  seed: number,
): { readonly u: Vec2; readonly v: Vec2 } | null {
  const origin = pool[seed];
  if (origin === undefined) return null;
  const byDistance = pool
    .map((p, index) => ({ index, dx: p.x - origin.x, dy: p.y - origin.y }))
    .filter((n) => n.index !== seed)
    .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
  const first = byDistance[0];
  if (first === undefined) return null;
  const u = { x: first.dx, y: first.dy };
  const uLen = Math.hypot(u.x, u.y);
  for (const n of byDistance.slice(1)) {
    const len = Math.hypot(n.dx, n.dy);
    const ratio = len / uLen;
    if (ratio > BASIS_MAX_LENGTH_RATIO || ratio < 1 / BASIS_MAX_LENGTH_RATIO) continue;
    const cos = (u.x * n.dx + u.y * n.dy) / (uLen * len);
    if (Math.abs(cos) <= BASIS_MAX_ABS_COS) return { u, v: { x: n.dx, y: n.dy } };
  }
  return null;
}

// Grow integer lattice coordinates outward from the seed at (0,0). Each cell
// tries its four neighbours; the predicted position uses second-order
// extrapolation from the two cells behind it when available (tracks local
// perspective), falling back to the seed basis vector near the seed.
function growLattice(
  pool: ReadonlyArray<CornerCandidate>,
  seed: number,
  u: Vec2,
  v: Vec2,
): Lattice {
  const cells = new Map<GridKey, number>();
  const used = new Set<number>();
  cells.set(key(0, 0), seed);
  used.add(seed);
  const frontier: Array<readonly [number, number]> = [[0, 0]];
  const steps: ReadonlyArray<readonly [number, number, Vec2]> = [
    [1, 0, u],
    [-1, 0, { x: -u.x, y: -u.y }],
    [0, 1, v],
    [0, -1, { x: -v.x, y: -v.y }],
  ];
  let head = 0;
  while (head < frontier.length) {
    const cell = frontier[head];
    head += 1;
    if (cell === undefined) continue;
    const [i, j] = cell;
    for (const [di, dj, fallback] of steps) {
      const target = key(i + di, j + dj);
      if (cells.has(target)) continue;
      const predicted = predictPosition(pool, cells, i, j, di, dj, fallback);
      if (predicted === null) continue;
      const found = nearestWithin(pool, used, predicted.at, predicted.spacing);
      if (found === null) continue;
      cells.set(target, found);
      used.add(found);
      frontier.push([i + di, j + dj]);
    }
  }
  return { cells };
}

function candidateAt(
  pool: ReadonlyArray<CornerCandidate>,
  cells: ReadonlyMap<GridKey, number>,
  i: number,
  j: number,
): Vec2 | null {
  const index = cells.get(key(i, j));
  if (index === undefined) return null;
  const p = pool[index];
  return p === undefined ? null : { x: p.x, y: p.y };
}

function predictPosition(
  pool: ReadonlyArray<CornerCandidate>,
  cells: ReadonlyMap<GridKey, number>,
  i: number,
  j: number,
  di: number,
  dj: number,
  fallback: Vec2,
): { readonly at: Vec2; readonly spacing: number } | null {
  const from = candidateAt(pool, cells, i, j);
  if (from === null) return null; // frontier cells are always assigned; type guard only
  const behind = candidateAt(pool, cells, i - di, j - dj);
  if (behind !== null) {
    const step = { x: from.x - behind.x, y: from.y - behind.y };
    return {
      at: { x: from.x + step.x, y: from.y + step.y },
      spacing: Math.hypot(step.x, step.y),
    };
  }
  return {
    at: { x: from.x + fallback.x, y: from.y + fallback.y },
    spacing: Math.hypot(fallback.x, fallback.y),
  };
}

function nearestWithin(
  pool: ReadonlyArray<CornerCandidate>,
  used: ReadonlySet<number>,
  target: Vec2,
  spacing: number,
): number | null {
  const tolerance = spacing * PREDICT_TOLERANCE;
  let bestIndex: number | null = null;
  let bestDistance = tolerance;
  for (let index = 0; index < pool.length; index += 1) {
    if (used.has(index)) continue;
    const p = pool[index];
    if (p === undefined) continue;
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d <= bestDistance) {
      bestDistance = d;
      bestIndex = index;
    }
  }
  return bestIndex;
}

// Find a fully-assigned rows×cols (or transposed cols×rows) window inside the
// grown lattice and return its corners ordered row-major with a deterministic
// orientation. Any leftover ambiguity (a 180° flip on symmetric boards) is
// absorbed by the per-view pose in calibration.
function extractOrderedWindow(
  pool: ReadonlyArray<CornerCandidate>,
  lattice: Lattice,
  spec: CheckerboardSpec,
): GridResult {
  const coords = [...lattice.cells.keys()].map((k) => k.split(',').map(Number));
  const is = coords.map((c) => c[0] ?? 0);
  const js = coords.map((c) => c[1] ?? 0);
  const bounds = {
    iMin: Math.min(...is),
    iMax: Math.max(...is),
    jMin: Math.min(...js),
    jMax: Math.max(...js),
  };
  // Try the board's rows along the lattice i-axis first, then transposed.
  for (const rowsAlongI of [true, false]) {
    const down = rowsAlongI ? spec.rows : spec.cols;
    const right = rowsAlongI ? spec.cols : spec.rows;
    const window = findFullWindow(lattice, bounds, down, right, rowsAlongI);
    if (window !== null) {
      return { kind: 'ok', corners: orderWindow(pool, lattice, window, spec) };
    }
  }
  return { kind: 'failed', reason: 'grid-mismatch' };
}

type Window = {
  readonly i0: number;
  readonly j0: number;
  // Rows of the OUTPUT grid advance along +i when `rowsAlongI`, else along +j.
  readonly rowsAlongI: boolean;
};

type LatticeBounds = {
  readonly iMin: number;
  readonly iMax: number;
  readonly jMin: number;
  readonly jMax: number;
};

function findFullWindow(
  lattice: Lattice,
  bounds: LatticeBounds,
  down: number,
  right: number,
  rowsAlongI: boolean,
): Window | null {
  for (let i0 = bounds.iMin; i0 + down - 1 <= bounds.iMax; i0 += 1) {
    for (let j0 = bounds.jMin; j0 + right - 1 <= bounds.jMax; j0 += 1) {
      if (windowComplete(lattice, i0, j0, down, right)) {
        return { i0, j0, rowsAlongI };
      }
    }
  }
  return null;
}

function windowComplete(
  lattice: Lattice,
  i0: number,
  j0: number,
  down: number,
  right: number,
): boolean {
  for (let di = 0; di < down; di += 1) {
    for (let dj = 0; dj < right; dj += 1) {
      if (!lattice.cells.has(key(i0 + di, j0 + dj))) return false;
    }
  }
  return true;
}

// Order the window row-major (spec.rows × spec.cols). The lattice's i-axis is
// the output row axis when the window's i-extent matches spec.rows; otherwise
// rows run along j. Directions are then flipped deterministically so the first
// corner is the topmost (then leftmost) of the four window corners in image
// space, which keeps repeated detections of a static board identically ordered.
function orderWindow(
  pool: ReadonlyArray<CornerCandidate>,
  lattice: Lattice,
  window: Window,
  spec: CheckerboardSpec,
): ReadonlyArray<Vec2> {
  const down = spec.rows;
  const right = spec.cols;
  const corners: Vec2[] = [];
  const orientation = chooseOrientation(pool, lattice, window, down, right);
  for (let r = 0; r < down; r += 1) {
    for (let c = 0; c < right; c += 1) {
      corners.push(orientation(r, c));
    }
  }
  return corners;
}

function chooseOrientation(
  pool: ReadonlyArray<CornerCandidate>,
  lattice: Lattice,
  window: Window,
  down: number,
  right: number,
): (r: number, c: number) => Vec2 {
  const at = (i: number, j: number): Vec2 => {
    const p = candidateAt(pool, lattice.cells, i, j);
    // The window was verified complete, so every cell resolves; (0,0) is
    // unreachable and only satisfies the type.
    return p ?? { x: 0, y: 0 };
  };
  const cell = (r: number, c: number, flipR: boolean, flipC: boolean): Vec2 => {
    const rr = flipR ? down - 1 - r : r;
    const cc = flipC ? right - 1 - c : c;
    const i = window.i0 + (window.rowsAlongI ? rr : cc);
    const j = window.j0 + (window.rowsAlongI ? cc : rr);
    return at(i, j);
  };
  let bestFlipR = false;
  let bestFlipC = false;
  let bestStart: Vec2 | null = null;
  for (const flipR of [false, true]) {
    for (const flipC of [false, true]) {
      const start = cell(0, 0, flipR, flipC);
      if (
        bestStart === null ||
        start.y < bestStart.y ||
        (start.y === bestStart.y && start.x < bestStart.x)
      ) {
        bestStart = start;
        bestFlipR = flipR;
        bestFlipC = flipC;
      }
    }
  }
  return (r, c) => cell(r, c, bestFlipR, bestFlipC);
}
