// The samples a binary crack chain actually measures on a gentle slope.
//
// A pixel is ink when its centre is inside the shape, so along a shallow edge
// the outline crosses each row's centre line at a riser and each crack's level
// at the middle of the run between two risers. A run's ends are not samples at
// all: they stand up to half a pixel off the outline, and a long run is a long
// stretch of them. A smoothing window cannot remove that once the stairs are
// longer than the window (rolling audit v9 R2-P2-2: on a 1024 px disc the runs
// at the top reach 37 px). So the points of a long run are moved onto the two
// chords that join its middle to the runs either side.
//
// A run that turns the same way at both ends (a cap) may be a true straight
// edge between two rounded corners rather than the top of a curve. A curve's
// cap is at most a few times the next run along its own axis; a longer cap
// stays flat.

import type { Vec2 } from '../scene';
import { fairChainSegments } from './fair-chain';
import { flattenStraightRuns } from './flatten-straight-runs';

// Binary loops from this many chain points up relax their stairs and take the
// fairing-by-fitting tail, as organic measured loops do. The simplify + spline
// tail follows the stairs of a gentle arc: its arc evening's window is shorter
// than they are past a radius of about 100 px, so it fits a tight circle to one
// riser and pulls the chain up to 1 px off the curve, and simplify then keeps
// those points (rolling audit v9 R2-P2-2, ADR-530 Amendment 14). Shorter loops
// are glyphs and small shapes, whose corners that tail is tuned for.
const LONG_BINARY_MIN_CHAIN_POINTS = 400;

const MIN_RELAXED_RUN_POINTS = 6;
const MAX_CAP_TO_NEXT_RUN = 4;

type Run = {
  readonly start: number;
  readonly length: number;
  /** The chain turns the same way entering and leaving it. */
  readonly isCap: boolean;
};

/** True when a binary loop's mid-crack chain is long enough for this tail. */
export function isLongBinaryLoop(
  chain: ReadonlyArray<Vec2>,
  finish: { readonly pixelScale: number },
): boolean {
  return chain.length >= LONG_BINARY_MIN_CHAIN_POINTS * finish.pixelScale;
}

/** The long binary loop's evened chain, its straight runs flattened between
 *  corners and the whole faired, ready for the compact fit. */
export function fairLongBinaryChain(
  evened: ReadonlyArray<Vec2>,
  corners: ReadonlySet<Vec2>,
  flattenStrength: number,
  pixelScale: number,
): Vec2[] {
  // The flatten keeps only a straight run's ends, and the fairing works by
  // index, so the chain goes back to an even spacing between them.
  const flattened =
    corners.size === 0
      ? evened
      : evenlySpaced(flattenStraightRuns(evened, true, corners, flattenStrength, pixelScale));
  return fairChainSegments(flattened, true, corners, pixelScale);
}

/** A copy of a closed mid-crack chain with its long stair runs relaxed. Corner
 *  objects and every point outside a long run are the same objects. */
export function relaxStairRuns(chain: ReadonlyArray<Vec2>, corners: ReadonlySet<Vec2>): Vec2[] {
  const runs = stairRuns(chain);
  const out = [...chain];
  const count = runs.length;
  if (count < 5) return out;
  runs.forEach((run, r) => {
    if (run.length < MIN_RELAXED_RUN_POINTS) return;
    const before = runs[(r + count - 1) % count] as Run;
    const after = runs[(r + 1) % count] as Run;
    const next = Math.max(
      (runs[(r + count - 2) % count] as Run).length,
      (runs[(r + 2) % count] as Run).length,
    );
    if (run.isCap && run.length > MAX_CAP_TO_NEXT_RUN * next) return;
    const left = neighbourAnchor(chain, before, run.start);
    const right = neighbourAnchor(chain, after, after.start);
    moveOntoChords(chain, out, run, left, right, corners);
  });
  return out;
}

function moveOntoChords(
  chain: ReadonlyArray<Vec2>,
  out: Vec2[],
  run: Run,
  left: Vec2,
  right: Vec2,
  corners: ReadonlySet<Vec2>,
): void {
  const n = chain.length;
  const middle = runMiddle(chain, run);
  const midIndex = (run.length - 1) / 2;
  for (let k = 0; k < run.length; k += 1) {
    const index = (run.start + k) % n;
    if (corners.has(chain[index] as Vec2)) continue;
    const [a, b, t] =
      k <= midIndex
        ? ([left, middle, (k + 1) / (midIndex + 1)] as const)
        : ([middle, right, (k - midIndex) / (midIndex + 1)] as const);
    out[index] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
}

// A chord ends at the middle of a short neighbour. Two long runs meeting are
// two drawn edges, so each chord ends where they join (`joinAt` is the first
// point of the later run).
function neighbourAnchor(chain: ReadonlyArray<Vec2>, neighbour: Run, joinAt: number): Vec2 {
  if (neighbour.length < MIN_RELAXED_RUN_POINTS) return runMiddle(chain, neighbour);
  const n = chain.length;
  const a = chain[(joinAt + n - 1) % n] as Vec2;
  const b = chain[joinAt % n] as Vec2;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function runMiddle(chain: ReadonlyArray<Vec2>, run: Run): Vec2 {
  const n = chain.length;
  const a = chain[(run.start + ((run.length - 1) >> 1)) % n] as Vec2;
  const b = chain[(run.start + (run.length >> 1)) % n] as Vec2;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Maximal stretches of the chain's points along one axis-aligned unit direction;
// a point with no such edge on either side is a run of one.
function stairRuns(chain: ReadonlyArray<Vec2>): Run[] {
  const n = chain.length;
  const directions = new Int8Array(n);
  for (let i = 0; i < n; i += 1) directions[i] = edgeDirection(chain, i);
  const starts: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const incoming = directions[(i + n - 1) % n] as number;
    const outgoing = directions[i] as number;
    if (incoming === 0 || (outgoing !== 0 && outgoing !== incoming)) starts.push(i);
  }
  return starts.map((start, s) => {
    const next = starts[(s + 1) % starts.length] as number;
    const length = ((next - start + n - 1) % n) + 1;
    const isCap = turnAt(chain, start) === turnAt(chain, (start + length - 1) % n);
    return { start, length, isCap };
  });
}

function turnAt(chain: ReadonlyArray<Vec2>, i: number): number {
  const n = chain.length;
  const a = chain[(i + n - 1) % n] as Vec2;
  const b = chain[i] as Vec2;
  const c = chain[(i + 1) % n] as Vec2;
  return Math.sign((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
}

// 1-4 for a unit step along an axis, 0 for anything else (a diagonal between
// two cracks, a spliced corner apex).
function edgeDirection(chain: ReadonlyArray<Vec2>, i: number): number {
  const p = chain[i] as Vec2;
  const q = chain[(i + 1) % chain.length] as Vec2;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  if (dy === 0 && Math.abs(dx) === 1) return dx > 0 ? 1 : 2;
  if (dx === 0 && Math.abs(dy) === 1) return dy > 0 ? 3 : 4;
  return 0;
}

// A closed chain with points added along its long edges, about a chain point
// apart. Its own points stay the same objects, so corners stay pinned.
function evenlySpaced(chain: ReadonlyArray<Vec2>): Vec2[] {
  const out: Vec2[] = [];
  chain.forEach((p, i) => {
    const q = chain[(i + 1) % chain.length] as Vec2;
    const parts = Math.max(1, Math.round(Math.hypot(q.x - p.x, q.y - p.y)));
    out.push(p);
    for (let k = 1; k < parts; k += 1) {
      out.push({ x: p.x + ((q.x - p.x) * k) / parts, y: p.y + ((q.y - p.y) * k) / parts });
    }
  });
  return out;
}
