// Corner dial for the contour tracer (ADR-404): the ONE stage that decides
// which boundary turns are corners, before any smoothing touches the loop.
//
// Every loop — binary or anti-aliased, any length — is scanned on its raw
// crack chain (one point per pixel-edge crack, sub-pixel measured where the
// pre-threshold field allows). Each candidate corner carries a ROUNDING COST
// in source px, and the Smoothness setting maps to one threshold: a candidate
// is a corner exactly when its cost exceeds the threshold, and the greedy
// selection by cost keeps a prefix of the same ordered list as the threshold
// rises, so the corner count does not rise with Smoothness (checked on a fine
// grid for squares, diamonds, wedges, discs and sprites; contour-corners.test).
//
// Three kinds of evidence, one cost scale:
//
// * Lattice turns (binary loops): every turn of the pixel staircase costs at
//   least tan(22.5°) ≈ 0.414 px, the gap a fillet across a one-pixel step
//   cuts, so on a native-resolution mask thresholds below that keep every
//   pixel corner: Smoothness 0 is the exact pixel polygon. (A supersampled
//   mask's steps are the upscaler's rounding, not source pixels; it is priced
//   on features and legs alone.)
// * Pixel features (binary loops): a cap — a run the staircase U-turns around
//   — no longer than its flanks is drawn detail (a tooth, a notch, a stem end,
//   a pixel-art square); smoothing melts it, so rounding it costs its height.
//   A digitized straight line never has a cap and a digitized convex curve has
//   them only at its extremes, as its longest runs or as a short cap the
//   circle through its surroundings accounts for.
// * Leg corners (every loop): two straight legs, each the longest run of crack
//   points within a line tolerance, meeting at a turn. The corner vertex is
//   the legs' intersection — sub-pixel exact for slanted and anti-aliased
//   edges — and the cost is the fillet gap min(leg) × tan(turn / 4), capped by
//   how much worse ONE circle explains the neighbourhood than the two legs do
//   (a digitized or wobbly arc fits a circle as well as its own legs, so it
//   never pays a corner's price).
//
// Past the one-pixel step, lattice jags are gone and leg corners and pixel
// features remain; at the slider maximum (4/3) no finite cost survives.
// Hoshyari et al. 2018 (perception-driven semi-structured boundary
// vectorization) motivates pricing corner-vs-smooth per candidate; the cap
// rule, the leg model, the fillet-gap cost and the circle cap are this
// module's own design.

import type { Vec2 } from '../scene';
import { latticeCandidates } from './contour-corner-lattice';
import {
  fitLeg,
  growLeg,
  legCandidates,
  legIntersection,
  LEG_SLOPE_TOLERANCE,
} from './contour-corner-legs';
import {
  LATTICE_STEP_COST_PX,
  MIN_LEG_POINTS,
  POINTS_PER_PX,
  type Candidate,
  type ContourCorner,
  type CornerDialInput,
} from './contour-corner-types';

export type { ContourCorner, CornerDialInput } from './contour-corner-types';

// The dial reads the slider as a fraction of a quarter turn, phi = (s / smax)
// * 90 degrees, and prices it on the same tangent scale as the fillet costs
// below: threshold(s) = SCALE * tan(phi). The slider maximum (4/3, LightBurn's
// range) is the quarter turn, where the tangent and the threshold are
// unbounded (no corners). SCALE = 2 tan(22.5 deg) puts the neutral default s = 1
// (phi = 67.5 deg) at exactly 2 px, the fillet gap of a right angle with legs
// of ~5 px: pixel squares from 4 px stay square as pixel features and
// digitized discs stay round. s = 0 is 0 (every pixel corner). The lattice
// step cost is reached at s ~ 0.39, so the pixel-staircase plateau covers the
// bottom ~30% of the slider.
const SMOOTHNESS_MAX = 4 / 3;
const THRESHOLD_SCALE_PX = 2 * Math.tan(Math.PI / 8);
const DEFAULT_SMOOTHNESS = 1;

// Two corners conflict when one's apex lies inside the other's straight legs
// by more than this many px.
const LEG_INTERIOR_MARGIN_PX = 2;

/** The Smoothness dial as a rounding-cost threshold in source px. */
export function cornerThresholdFromSmoothness(smoothness: number | undefined): number {
  const s = Number.isFinite(smoothness) ? (smoothness as number) : DEFAULT_SMOOTHNESS;
  if (s <= 0) return 0;
  if (s >= SMOOTHNESS_MAX) return Infinity;
  return THRESHOLD_SCALE_PX * Math.tan((Math.PI / 2) * (s / SMOOTHNESS_MAX));
}

/** Decide the loop's corners, ordered by `from`. */
export function decideContourCorners(input: CornerDialInput): ContourCorner[] {
  const n = input.cracks.length;
  if (n < 4 || input.staircase.length !== n) return [];
  const threshold = input.thresholdPx;
  if (!(threshold < Infinity)) return [];
  const scale = Math.max(1, input.pixelScale);
  // Only a native-resolution staircase is the pixel polygon. A supersampled
  // mask's staircase draws the upscaler's rounding at every source corner in
  // sub-source-pixel steps; keeping those steps would round the corners the
  // leg candidates place exactly, so a supersampled loop is always priced on
  // features and legs (at s = 0 every compatible one is kept).
  const latticeRegime = !input.measured && scale === 1 && threshold < LATTICE_STEP_COST_PX;
  const lattice = latticeCandidates(input, scale);
  // Past the one-pixel step, a lattice turn is only a candidate as a pixel
  // feature: every other drawn corner has straight legs and is priced as a
  // leg corner (with the one-circle cap a bare run-length price lacks — a
  // jittered digital circle has five-pixel runs meeting at right angles).
  const candidates = latticeRegime
    ? lattice
    : [...lattice.filter((c) => c.feature === true), ...legCandidates(input, scale, lattice)];
  const alive = candidates.filter((c) => c.cost > threshold);
  const chosen = (latticeRegime ? alive : selectCompatible(alive, n, scale))
    .map(({ from, skip, apex, cost }) => ({ from, skip, apex, cost }))
    .sort((a, b) => a.from - b.from);
  const noise = (input.edgeNoisePx ?? 0) * scale;
  return noise > 0 ? reseatApexes(input.cracks, chosen, noise, scale) : chosen;
}

// ——— apex re-seating ———

// The decision stage fits legs at quantization tolerance, so on a wobbly edge
// a leg follows the local wobble and its apex lands on it. When the finishing
// stages will straighten wobble of amplitude `noise` away (the straight-run
// flattener), each apex is re-seated at the intersection of legs grown at
// THAT tolerance — the lines the flattener will draw — so a pinned corner does
// not hold a wobble extreme in place and break the straight run beside it.
// Which corners exist is unchanged (the count stays monotone in Smoothness).
const RESEAT_LEG_CAP_PX = 48;
const RESEAT_LIMIT_PX = 2;

function reseatApexes(
  cracks: ReadonlyArray<Vec2>,
  corners: ReadonlyArray<ContourCorner>,
  noise: number,
  scale: number,
): ContourCorner[] {
  const n = cracks.length;
  const count = corners.length;
  const cap = Math.ceil(RESEAT_LEG_CAP_PX * scale * POINTS_PER_PX);
  return corners.map((corner, k) => {
    // A pixel corner (lattice turn or feature) is exact already.
    if (Number.isInteger(corner.apex.x) && Number.isInteger(corner.apex.y)) return corner;
    const prev = corners[(k - 1 + count) % count] as ContourCorner;
    const next = corners[(k + 1) % count] as ContourCorner;
    const aheadStart = (corner.from + corner.skip + 1) % n;
    // Legs stop short of the neighbouring corners' own spans.
    const roomBack =
      count === 1 ? n - corner.skip - 1 : ((corner.from - (prev.from + prev.skip) - 1 + n) % n) + 1;
    const roomAhead = count === 1 ? n - corner.skip - 1 : ((next.from - aheadStart + n) % n) + 1;
    const tolerance = { base: noise, slope: LEG_SLOPE_TOLERANCE };
    const backCount = growLeg(cracks, corner.from, -1, Math.min(cap, roomBack), tolerance);
    const aheadCount = growLeg(cracks, aheadStart, 1, Math.min(cap, roomAhead), tolerance);
    if (backCount < MIN_LEG_POINTS || aheadCount < MIN_LEG_POINTS) return corner;
    const back = fitLeg(cracks, corner.from, backCount, -1);
    const ahead = fitLeg(cracks, aheadStart, aheadCount, 1);
    const apex = legIntersection(back, ahead);
    if (apex === null) return corner;
    const moved = Math.hypot(apex.x - corner.apex.x, apex.y - corner.apex.y);
    return moved <= RESEAT_LIMIT_PX * scale ? { ...corner, apex } : corner;
  });
}

// Exact pixel corners of two outlines that touch only diagonally share one
// lattice vertex, and so does a loop pinched at a checkerboard. Touching
// outlines read as a topology conflict downstream (which would strip the
// corners again), so each such apex steps SADDLE_INSET_PX (mask px) into its
// own corner, toward the midpoint of its two cracks: separate outlines, still
// pixel-exact to well under a hundredth of a pixel.
const SADDLE_INSET_PX = 1 / 128;

/** Pull lattice apexes at saddle vertices a hair into their own corner. */
export function separateSaddleApexes(
  corners: ReadonlyArray<ContourCorner>,
  cracks: ReadonlyArray<Vec2>,
  isSaddle: (vertex: Vec2) => boolean,
): ContourCorner[] {
  const n = cracks.length;
  return corners.map((corner) => {
    if (corner.skip !== 0 || !isSaddle(corner.apex)) return corner;
    const before = cracks[corner.from] as Vec2;
    const after = cracks[(corner.from + 1) % n] as Vec2;
    const tx = (before.x + after.x) / 2 - corner.apex.x;
    const ty = (before.y + after.y) / 2 - corner.apex.y;
    const length = Math.hypot(tx, ty);
    if (length < 1e-9) return corner;
    const step = SADDLE_INSET_PX / length;
    return { ...corner, apex: { x: corner.apex.x + tx * step, y: corner.apex.y + ty * step } };
  });
}

export type CornerChain = {
  /** Cracks with every corner's skipped cracks replaced by its apex. */
  readonly points: Vec2[];
  readonly corners: ReadonlySet<Vec2>;
  /** Index into `points` for each crack (a skipped crack maps to its apex). */
  readonly crackIndex: Int32Array;
};

/** Splice the corner apexes into the crack chain. */
export function chainWithCorners(
  cracks: ReadonlyArray<Vec2>,
  corners: ReadonlyArray<ContourCorner>,
): CornerChain {
  const n = cracks.length;
  const apexAfter = new Map<number, ContourCorner>();
  const skipped = new Uint8Array(n);
  for (const corner of corners) {
    apexAfter.set(corner.from, corner);
    for (let k = 1; k <= corner.skip; k += 1) skipped[(corner.from + k) % n] = 1;
  }
  const points: Vec2[] = [];
  const crackIndex = new Int32Array(n).fill(-1);
  const set = new Set<Vec2>();
  // Start on a crack no apex replaces so no splice straddles the seam.
  let start = 0;
  while (start < n && skipped[start] === 1) start += 1;
  const pending: number[] = [];
  for (let step = 0; step < n; step += 1) {
    const i = (start + step) % n;
    if (skipped[i] === 1) {
      pending.push(i);
      continue;
    }
    crackIndex[i] = points.length;
    points.push(cracks[i] as Vec2);
    const corner = apexAfter.get(i);
    if (corner === undefined) continue;
    set.add(corner.apex);
    const apexIndex = points.length;
    points.push(corner.apex);
    for (let k = 1; k <= corner.skip; k += 1) crackIndex[(i + k) % n] = apexIndex;
  }
  for (const i of pending) if ((crackIndex[i] as number) < 0) crackIndex[i] = 0;
  return { points, corners: set, crackIndex };
}

// ——— selection ———

// Greedy by cost: a candidate is kept unless its apex sits inside the straight
// legs (or apex gap) of a costlier kept corner, or a kept corner's apex sits
// inside its own legs. Straight legs cannot contain a corner.
function selectCompatible(
  candidates: ReadonlyArray<Candidate>,
  n: number,
  scale: number,
): Candidate[] {
  const order = [...candidates].sort(
    (x, y) => y.cost - x.cost || x.skip - y.skip || x.from - y.from,
  );
  const margin = Math.max(1, Math.round(LEG_INTERIOR_MARGIN_PX * scale));
  const kept: Candidate[] = [];
  // Occupancy of kept apex gaps, in doubled crack coordinates.
  for (const candidate of order) {
    if (kept.some((other) => conflicts(candidate, other, n, margin))) continue;
    kept.push(candidate);
  }
  return kept;
}

function conflicts(x: Candidate, y: Candidate, n: number, margin: number): boolean {
  return apexInsideLegs(x, y, n, margin) || apexInsideLegs(y, x, n, margin);
}

// Apex of `x` (the half-open crack gap from+0.5 … from+skip+0.5) inside the
// leg span of `y` shrunk by `margin` cracks at both far ends. Coordinates are
// doubled so half-crack positions are integers.
function apexInsideLegs(x: Candidate, y: Candidate, n: number, margin: number): boolean {
  const ring = 2 * n;
  const lo = 2 * (y.from - y.legBack + 1 + margin);
  const hi = 2 * (y.from + y.skip + 1 + y.legAhead - 1 - margin);
  if (hi <= lo) return false;
  const span = hi - lo;
  const xLo = 2 * x.from + 1;
  const xHi = 2 * (x.from + x.skip) + 1;
  for (let p = xLo; p <= xHi; p += 2) {
    const offset = (((p - lo) % ring) + ring) % ring;
    if (offset > 0 && offset < span) return true;
  }
  return false;
}
