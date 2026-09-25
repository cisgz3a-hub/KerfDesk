// Lattice evidence for the corner dial (ADR-404): every turn of a binary pixel
// staircase, pixel features (caps no longer than their flanks), and the
// lattice vertices a straight leg may not cross.

import type { Vec2 } from '../scene';
import { fitCircle } from './contour-corner-circle';
import {
  KEPT_FEATURE,
  LATTICE_STEP_COST_PX,
  LEG_CAP_PX,
  PIXEL_CORNER,
  POINTS_PER_PX,
  type Candidate,
  type CornerDialInput,
} from './contour-corner-types';

// A binary crack sits on its lattice midpoint to within the boundary walker's
// own interpolation epsilon (contour-boundary.ts), in mask px.
const EXACT_CRACK_PX = 0.05;

// Every turn of a binary staircase whose two cracks sit exactly mid-crack.
export function latticeCandidates(input: CornerDialInput, scale: number): Candidate[] {
  if (input.measured) return [];
  const { staircase, cracks } = input;
  const n = cracks.length;
  const dirs = new Int8Array(n);
  const exact = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = staircase[i] as Vec2;
    const b = staircase[(i + 1) % n] as Vec2;
    dirs[i] = latticeDirection(b.x - a.x, b.y - a.y);
    const c = cracks[i] as Vec2;
    exact[i] = Math.hypot(c.x - (a.x + b.x) / 2, c.y - (a.y + b.y) / 2) <= EXACT_CRACK_PX ? 1 : 0;
  }
  const runEnd = sameDirectionRuns(dirs, n, 1);
  const runStart = sameDirectionRuns(dirs, n, -1);
  const cap = LEG_CAP_PX * scale;
  const featureHeight = pixelFeatureHeights(dirs, runStart, cracks, scale);
  const out: Candidate[] = [];
  for (let i = 0; i < n; i += 1) {
    const before = (i - 1 + n) % n;
    if (dirs[before] === dirs[i] || exact[before] !== 1 || exact[i] !== 1) continue;
    const back = runEnd[before] as number;
    const ahead = runStart[i] as number;
    const vertex = staircase[i] as Vec2;
    const fillet = Math.min(back, ahead, cap) * LATTICE_STEP_COST_PX;
    const feature = Math.min(featureHeight.get(i) ?? 0, cap);
    out.push({
      from: before,
      skip: 0,
      apex: { x: vertex.x, y: vertex.y },
      cost: Math.max(fillet, feature) / scale,
      legBack: back,
      legAhead: ahead,
      feature: feature > 0,
    });
  }
  return out;
}

// Pixel features: a CAP is a run whose two end turns have the same sign (the
// staircase U-turns around it: a tooth, a notch, a stem end). A digitized
// straight line never has one — its jags alternate — and a digitized convex
// curve has them only at its extremes, usually as its longest runs. A cap no
// longer than the runs flanking its two sides is therefore drawn detail, and
// smoothing melts it down to nothing: rounding it costs its whole height (the
// U-turn fillet gap, h · tan(180°/4) = h, with h the shorter side) — unless
// the circle through its surroundings accounts for it (see capOnCircle).
// Returns that height (mask px) at both cap vertices, keyed by the crack index
// that starts the vertex's outgoing run.
function pixelFeatureHeights(
  dirs: Int8Array,
  runStart: Int32Array,
  cracks: ReadonlyArray<Vec2>,
  scale: number,
): Map<number, number> {
  const n = cracks.length;
  const heights = new Map<number, number>();
  const starts: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (dirs[i] !== dirs[(i - 1 + n) % n]) starts.push(i);
  }
  const count = starts.length;
  if (count < 4) return heights;
  const len = (k: number): number =>
    runStart[starts[((k % count) + count) % count] as number] as number;
  const dir = (k: number): number =>
    dirs[starts[((k % count) + count) % count] as number] as number;
  const turn = (k: number): number => (dir(k) - dir(k - 1) + 4) % 4;
  const runs: RunAccess = { len, start: (k) => starts[((k % count) + count) % count] as number };
  for (let k = 0; k < count; k += 1) {
    if (turn(k) !== turn(k + 1)) continue;
    if (len(k) > Math.min(len(k - 2), len(k + 2))) continue;
    // One-pixel side, flank and next side on both hands, with no cap among
    // them, is a digitized slanted edge stepping on: the cap is then the tip
    // of a slanted corner (a diamond's apex pixel), which its legs place
    // better than its pixel. Repeated detail (a row of one-pixel teeth) has
    // caps for flanks, and a tooth ending a row has a long run beyond.
    const staircase = (side: number, flank: number, beyond: number): boolean =>
      len(side) === 1 && len(flank) === 1 && len(beyond) === 1 && turn(flank) !== turn(flank + 1);
    if (staircase(k - 1, k - 2, k - 3) && staircase(k + 1, k + 2, k + 3)) continue;
    if (capOnCircle(cracks, runs, k, scale)) continue;
    const height = Math.min(len(k - 1), len(k + 1));
    for (const vertex of [starts[k] as number, starts[(k + 1) % count] as number]) {
      heights.set(vertex, Math.max(heights.get(vertex) ?? 0, height));
    }
  }
  return heights;
}

type RunAccess = {
  readonly len: (k: number) => number;
  readonly start: (k: number) => number;
};

// A digitized circle's extreme can be SHORTER than its flanks: a disc centred
// on a pixel centre with a whole radius ends in a one-pixel nipple, and an
// off-centre one in a short cap one pixel proud of a longer row. Such a cap is
// the circle's own digitization, not drawn detail: fit one circle to the
// cracks around the cap and its two sides (never through them) and, when that
// circle explains its surroundings to quantization accuracy, the cap cracks
// lie within about half a pixel of it (a pixel whose centre is inside the circle
// has cracks at most half a pixel outside). Drawn detail stands off by its
// height: a one-pixel tooth on a straight edge by one pixel. A neighbourhood
// that is one straight run, too short, or wraps round another corner fits no
// circle this well, and the cap stays a feature — pixel squares keep theirs.
const CAP_WINDOW_MIN_SIDE_CRACKS = 3;
const CIRCLE_FIT_RMS_PX = 0.35;
const CAP_ON_CIRCLE_PX = 0.75;

function capOnCircle(
  cracks: ReadonlyArray<Vec2>,
  runs: RunAccess,
  k: number,
  scale: number,
): boolean {
  const n = cracks.length;
  const first = runs.start(k - 1);
  const capStart = runs.start(k);
  const capLength = runs.len(k);
  const own = runs.len(k - 1) + capLength + runs.len(k + 1);
  const side = Math.min(Math.floor((n - own) / 2), Math.ceil(LEG_CAP_PX * scale * POINTS_PER_PX));
  if (side < CAP_WINDOW_MIN_SIDE_CRACKS) return false;
  const around: Vec2[] = [];
  for (let j = side; j >= 1; j -= 1) around.push(cracks[(((first - j) % n) + n) % n] as Vec2);
  for (let j = 0; j < side; j += 1) around.push(cracks[(first + own + j) % n] as Vec2);
  const circle = fitCircle(around, 0, around.length);
  if (circle === null || circle.rms > CIRCLE_FIT_RMS_PX) return false;
  for (let j = 0; j < capLength; j += 1) {
    const c = cracks[(capStart + j) % n] as Vec2;
    const off = Math.abs(Math.hypot(c.x - circle.x, c.y - circle.y) - circle.radius);
    if (off > CAP_ON_CIRCLE_PX) return false;
  }
  return true;
}

function latticeDirection(dx: number, dy: number): number {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 2;
  return dy >= 0 ? 1 : 3;
}

// Length of the same-direction crack run ending (step 1) or starting (step −1)
// at each crack.
function sameDirectionRuns(dirs: Int8Array, n: number, step: 1 | -1): Int32Array {
  const runs = new Int32Array(n);
  let uniform = true;
  for (let i = 1; i < n; i += 1) if (dirs[i] !== dirs[0]) uniform = false;
  if (uniform) return runs.fill(n);
  // Walk from a direction change so every run is counted whole.
  let origin = 0;
  while (dirs[origin] === dirs[(origin - step + n) % n]) origin = (origin + step + n) % n;
  for (let k = 0; k < n; k += 1) {
    const i = (origin + k * step + n * n) % n;
    const prev = (i - step + n) % n;
    runs[i] = k > 0 && dirs[prev] === dirs[i] ? (runs[prev] as number) + 1 : 1;
  }
  return runs;
}

// Lattice vertices a straight leg may not cross on a binary loop: turns whose
// runs are at least two cracks on BOTH sides, and the vertices of every pixel
// feature the dial keeps (a dropped feature is noise a leg may absorb). Every
// jag of a digital straight
// line has a one-crack run on one side, so slanted legs pass; a genuine pixel
// corner stops the leg exactly where the pixels turn (otherwise the leg's line
// fit could absorb the first crack round the corner and tilt).
export function latticeBarriers(
  input: CornerDialInput,
  lattice: ReadonlyArray<Candidate>,
): Uint8Array {
  const barriers = new Uint8Array(input.cracks.length);
  for (const corner of lattice) {
    const vertex = (corner.from + 1) % input.cracks.length;
    if (corner.feature === true && corner.cost > input.thresholdPx) {
      barriers[vertex] = KEPT_FEATURE;
    } else if (Math.min(corner.legBack, corner.legAhead) >= 2) {
      barriers[vertex] = Math.max(barriers[vertex] as number, PIXEL_CORNER);
    }
  }
  return barriers;
}
