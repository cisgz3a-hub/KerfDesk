// How the camera's view of its surround has moved, patch by patch, and what
// that does to the bed (ADR-663 Amendment 5, rolling audit v13 Y1-P2-2).
//
// One shift for the whole surround cannot follow a camera that turned: a roll
// of a degree moves the left and right of the view in opposite directions, so
// the single best shift matched weakly and said nothing while the bed's
// corners were 5-10 mm off. Small patches each still move almost rigidly, so
// each is matched on its own, and their moves are fitted on the bed plane in
// millimetres (a slide of the camera moves every point of the plane the same
// distance, wherever it shows in a wide lens). The bed's centre and corners
// are then moved by the fit, and the worst is reported. Pure core.

import { applyHomography } from '../homography';
import { weightedHomography } from '../weighted-homography';
import { bedMapper, type CameraPose, type LensModel, type Vec2 } from './camera-model';
import {
  bestShift,
  measureViewShift,
  surroundMask,
  edgeMap,
  gradientStep,
  halved,
  MIN_MATCH_SCORE,
  type Grid,
  type ViewThumbnail,
} from './view-shift';

/** A patch of the surround, thumbnail pixels on a side. */
export const PATCH_PX = 32;
/** The largest move looked for per patch, thumbnail pixels (about 50 mm). */
export const PATCH_REACH_PX = 24;
/** A patch is compared when at least this share of it is surround. */
const MIN_PATCH_SURROUND = 0.5;
/** Edge strength a patch needs (standard deviation of its edge map) to be worth matching. */
const MIN_PATCH_EDGE_STD = 4;
/** A patch whose edges all run one way cannot say where it moved along them. */
const MIN_PATCH_CORNERNESS = 0.05;
/** Fewer textured patches than this, and the patches say nothing either way. */
export const MIN_TEXTURED_PATCHES = 4;

/** One surround patch: where its centre is (thumbnail pixels) and how it moved. */
export type PatchShift = {
  readonly cx: number;
  readonly cy: number;
  readonly dxPx: number;
  readonly dyPx: number;
  readonly score: number;
};

export type SurroundPatches = {
  /** Patches with enough surround and texture to be matched at all. */
  readonly textured: number;
  /** Those that matched well enough to be trusted. */
  readonly matched: ReadonlyArray<PatchShift>;
};

/** Match each textured surround patch of `reference` in `current` on its own. */
export function surroundPatchShifts(
  reference: ViewThumbnail,
  current: ViewThumbnail,
  mask: Uint8Array,
  reach: number = PATCH_REACH_PX,
): SurroundPatches | null {
  const { width, height } = reference;
  if (current.width !== width || current.height !== height || mask.length !== width * height) {
    return null;
  }
  const a = edgeMap(reference);
  const b = edgeMap(current);
  const matched: PatchShift[] = [];
  let textured = 0;
  for (let y0 = 0; y0 + PATCH_PX / 2 <= height; y0 += PATCH_PX) {
    for (let x0 = 0; x0 + PATCH_PX / 2 <= width; x0 += PATCH_PX) {
      const box = {
        x0,
        y0,
        x1: Math.min(width, x0 + PATCH_PX),
        y1: Math.min(height, y0 + PATCH_PX),
      };
      const grid: Grid = { a, b, mask, width, height, box };
      if (!patchIsTextured(grid)) continue;
      textured += 1;
      const shift = patchShift(grid, reach);
      if (shift !== null && shift.score >= MIN_MATCH_SCORE) matched.push(shift);
    }
  }
  return { textured, matched };
}

function patchShift(grid: Grid, reach: number): PatchShift | null {
  const box = grid.box;
  if (box === undefined) return null;
  const coarse = bestShift(halved(grid), Math.ceil(reach / 2), { x: 0, y: 0 });
  if (coarse === null) return null;
  const found = bestShift(grid, 2, { x: 2 * coarse.best.x, y: 2 * coarse.best.y });
  if (found === null) return null;
  const step = gradientStep(grid, found.best);
  return {
    cx: (box.x0 + box.x1) / 2 - 0.5,
    cy: (box.y0 + box.y1) / 2 - 0.5,
    dxPx: step === null ? found.shift.dxPx : found.best.x + step.x,
    dyPx: step === null ? found.shift.dyPx : found.best.y + step.y,
    score: found.shift.score,
  };
}

type PatchStats = {
  readonly n: number;
  readonly edgeStd: number;
  /** Smaller over larger eigenvalue of the edge map's structure tensor. */
  readonly cornerness: number;
};

// Enough surround, strong enough edges, and edges running more than one way.
function patchIsTextured(grid: Grid): boolean {
  const box = grid.box;
  if (box === undefined) return false;
  const stats = patchStats(grid, box);
  const area = (box.x1 - box.x0) * (box.y1 - box.y0);
  return (
    stats.n >= MIN_PATCH_SURROUND * area &&
    stats.edgeStd >= MIN_PATCH_EDGE_STD &&
    stats.cornerness >= MIN_PATCH_CORNERNESS
  );
}

function patchStats(grid: Grid, box: NonNullable<Grid['box']>): PatchStats {
  const { a, mask, width } = grid;
  let n = 0;
  let sum = 0;
  let squares = 0;
  let gxx = 0;
  let gxy = 0;
  let gyy = 0;
  for (let y = Math.max(1, box.y0); y < Math.min(grid.height - 1, box.y1); y += 1) {
    for (let x = Math.max(1, box.x0); x < Math.min(width - 1, box.x1); x += 1) {
      const i = y * width + x;
      if (mask[i] !== 1) continue;
      const v = a[i] ?? 0;
      const gx = (a[i + 1] ?? 0) - (a[i - 1] ?? 0);
      const gy = (a[i + width] ?? 0) - (a[i - width] ?? 0);
      n += 1;
      sum += v;
      squares += v * v;
      gxx += gx * gx;
      gxy += gx * gy;
      gyy += gy * gy;
    }
  }
  if (n === 0) return { n, edgeStd: 0, cornerness: 0 };
  const mean = sum / n;
  const half = (gxx + gyy) / 2;
  const root = Math.sqrt(Math.max(0, ((gxx - gyy) / 2) ** 2 + gxy * gxy));
  return {
    n,
    edgeStd: Math.sqrt(Math.max(0, squares / n - mean * mean)),
    cornerness: half + root > 0 ? (half - root) / (half + root) : 0,
  };
}

export type BedMotionFit = 'homography' | 'similarity' | 'translation';

export type BedMotion = {
  /** Where each of {@link bedSamplePoints} now shows, less where the calibration puts it, mm. */
  readonly displacementsMm: ReadonlyArray<Vec2>;
  /** The largest of them, mm. */
  readonly worstMm: number;
  readonly fit: BedMotionFit;
  readonly patches: number;
};

/** The bed's centre, then its four corners, in that order. */
export function bedSamplePoints(bedWidthMm: number, bedHeightMm: number): ReadonlyArray<Vec2> {
  return [
    { x: bedWidthMm / 2, y: bedHeightMm / 2 },
    { x: 0, y: 0 },
    { x: bedWidthMm, y: 0 },
    { x: bedWidthMm, y: bedHeightMm },
    { x: 0, y: bedHeightMm },
  ];
}

type Correspondence = { readonly from: Vec2; readonly to: Vec2; readonly weight: number };
type MotionMap = (p: Vec2) => Vec2;

/**
 * Fit the matched patches' moves on the bed plane and move the bed's centre
 * and corners by it. A camera that moves sees its plane through a homography,
 * so that is fitted when the patches surround the bed; a turn and scale when
 * they spread one way; a slide otherwise. Each patch gives the bed point the
 * calibration puts at the pixel where that bit of surround now shows, so the
 * fit runs from those back to where they were: for any bed point it then says
 * where the camera now shows it. Null when too few patches map onto the plane
 * or agree with each other.
 */
export function bedMotionFromPatches(args: {
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly thumbWidth: number;
  readonly thumbHeight: number;
  readonly patches: ReadonlyArray<PatchShift>;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
}): BedMotion | null {
  const toBed = bedMapper(args.lens, args.pose);
  const sx = args.lens.imageWidth / args.thumbWidth;
  const sy = args.lens.imageHeight / args.thumbHeight;
  const camera = (x: number, y: number): Vec2 => ({
    x: (x + 0.5) * sx - 0.5,
    y: (y + 0.5) * sy - 0.5,
  });
  const pairs: Correspondence[] = [];
  for (const patch of args.patches) {
    const was = toBed(camera(patch.cx, patch.cy), 0);
    const readsNow = toBed(camera(patch.cx + patch.dxPx, patch.cy + patch.dyPx), 0);
    if (was === null || readsNow === null) continue;
    pairs.push({ from: readsNow, to: was, weight: Math.max(patch.score, 0.01) });
  }
  if (pairs.length < 2) return null;
  const bedSpanMm = Math.min(args.bedWidthMm, args.bedHeightMm);
  const first = fitMotion(pairs, bedSpanMm);
  const kept = withoutOutliers(pairs, first.map);
  if (kept.length < Math.max(2, Math.ceil(pairs.length / 2))) return null;
  const { map, fit } = fitMotion(kept, bedSpanMm);
  const displacementsMm = bedSamplePoints(args.bedWidthMm, args.bedHeightMm).map((p) => {
    const now = map(p);
    return { x: now.x - p.x, y: now.y - p.y };
  });
  const worstMm = displacementsMm.reduce((worst, d) => Math.max(worst, Math.hypot(d.x, d.y)), 0);
  if (!Number.isFinite(worstMm)) return null;
  return { displacementsMm, worstMm, fit, patches: kept.length };
}

type Spread = { readonly mean: Vec2; readonly least: number; readonly most: number };

// The weighted centre of the points and their spread along the narrowest and
// widest directions (square roots of the covariance's eigenvalues), mm.
function spreadOf(points: ReadonlyArray<Vec2>, weights: ReadonlyArray<number>): Spread {
  let w = 0;
  let mx = 0;
  let my = 0;
  points.forEach((p, i) => {
    const k = weights[i] ?? 0;
    w += k;
    mx += k * p.x;
    my += k * p.y;
  });
  const mean = { x: mx / w, y: my / w };
  let xx = 0;
  let xy = 0;
  let yy = 0;
  points.forEach((p, i) => {
    const k = (weights[i] ?? 0) / w;
    xx += k * (p.x - mean.x) ** 2;
    xy += k * (p.x - mean.x) * (p.y - mean.y);
    yy += k * (p.y - mean.y) ** 2;
  });
  const half = (xx + yy) / 2;
  const root = Math.sqrt(Math.max(0, ((xx - yy) / 2) ** 2 + xy * xy));
  return { mean, least: Math.sqrt(Math.max(0, half - root)), most: Math.sqrt(half + root) };
}

function fitMotion(
  pairs: ReadonlyArray<Correspondence>,
  bedSpanMm: number,
): { readonly map: MotionMap; readonly fit: BedMotionFit } {
  const weights = pairs.map((pair) => pair.weight);
  const from = spreadOf(
    pairs.map((pair) => pair.from),
    weights,
  );
  if (pairs.length >= 6 && from.least >= 0.15 * bedSpanMm) {
    const matrix = weightedHomography(pairs);
    if (matrix !== null) return { fit: 'homography', map: (p) => applyHomography(matrix, p) };
  }
  const to = spreadOf(
    pairs.map((pair) => pair.to),
    weights,
  );
  if (from.most < 20) {
    const shift = { x: to.mean.x - from.mean.x, y: to.mean.y - from.mean.y };
    return { fit: 'translation', map: (p) => ({ x: p.x + shift.x, y: p.y + shift.y }) };
  }
  const [a, b] = similarityTerms(pairs, from.mean, to.mean);
  return {
    fit: 'similarity',
    map: (p) => {
      const ax = p.x - from.mean.x;
      const ay = p.y - from.mean.y;
      return { x: to.mean.x + a * ax - b * ay, y: to.mean.y + b * ax + a * ay };
    },
  };
}

// The scaled cosine and sine of the best turn about the two centres.
function similarityTerms(
  pairs: ReadonlyArray<Correspondence>,
  fromMean: Vec2,
  toMean: Vec2,
): readonly [number, number] {
  let p = 0;
  let q = 0;
  let norm = 0;
  for (const pair of pairs) {
    const ax = pair.from.x - fromMean.x;
    const ay = pair.from.y - fromMean.y;
    const bx = pair.to.x - toMean.x;
    const by = pair.to.y - toMean.y;
    p += pair.weight * (ax * bx + ay * by);
    q += pair.weight * (ax * by - ay * bx);
    norm += pair.weight * (ax * ax + ay * ay);
  }
  return norm > 0 ? [p / norm, q / norm] : [1, 0];
}

// Patches that disagree with the first fit (a false peak in a repeating
// texture, the gantry crossing a patch) are left out of the second.
function withoutOutliers(
  pairs: ReadonlyArray<Correspondence>,
  map: MotionMap,
): ReadonlyArray<Correspondence> {
  const residuals = pairs.map((pair) => {
    const moved = map(pair.from);
    return Math.hypot(moved.x - pair.to.x, moved.y - pair.to.y);
  });
  const sorted = [...residuals].sort((p, q) => p - q);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const limit = Math.max(3 * median, 1.5);
  return pairs.filter((_, i) => (residuals[i] ?? Number.POSITIVE_INFINITY) <= limit);
}

/**
 * A whole-surround shift in bed millimetres, measured where the surround is:
 * the median move on the bed plane of the surround pixels it shifts. (At the
 * bed's centre a wide lens shows a millimetre larger than at its edge, so
 * converting there understated a slide, Y1-P3-2.)
 */
export function surroundShiftOnBedMm(args: {
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly thumbWidth: number;
  readonly thumbHeight: number;
  readonly mask: Uint8Array;
  readonly dxPx: number;
  readonly dyPx: number;
}): Vec2 | null {
  const toBed = bedMapper(args.lens, args.pose);
  const sx = args.lens.imageWidth / args.thumbWidth;
  const sy = args.lens.imageHeight / args.thumbHeight;
  const camera = (x: number, y: number): Vec2 => ({
    x: (x + 0.5) * sx - 0.5,
    y: (y + 0.5) * sy - 0.5,
  });
  const xs: number[] = [];
  const ys: number[] = [];
  for (let ty = 0; ty < args.thumbHeight; ty += 3) {
    for (let tx = 0; tx < args.thumbWidth; tx += 3) {
      if (args.mask[ty * args.thumbWidth + tx] !== 1) continue;
      const was = toBed(camera(tx, ty), 0);
      const readsNow = toBed(camera(tx + args.dxPx, ty + args.dyPx), 0);
      if (was === null || readsNow === null) continue;
      // Where the bed now shows, less where the calibration puts it.
      xs.push(was.x - readsNow.x);
      ys.push(was.y - readsNow.y);
    }
  }
  if (xs.length === 0) return null;
  return { x: median(xs), y: median(ys) };
}

function median(values: number[]): number {
  values.sort((p, q) => p - q);
  return values[Math.floor(values.length / 2)] ?? 0;
}

type ViewComparison =
  | {
      readonly kind: 'measured';
      readonly displacementsMm: ReadonlyArray<Vec2>;
      readonly worstMm: number;
    }
  // The surround has texture to compare, and most of it no longer matches.
  | { readonly kind: 'weak' }
  // Nothing to compare: too little surround, or too plain.
  | { readonly kind: 'none' };

/** Patch by patch where the surround has texture enough; as one shift where it has not. */
export function compareViews(args: {
  readonly reference: ViewThumbnail;
  readonly current: ViewThumbnail;
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
}): ViewComparison {
  const { reference, current, lens, pose, bedWidthMm, bedHeightMm } = args;
  const thumb = { thumbWidth: current.width, thumbHeight: current.height };
  const mask = surroundMask({ lens, pose, ...thumb, bedWidthMm, bedHeightMm });
  const patches = surroundPatchShifts(reference, current, mask);
  if (patches !== null && patches.textured >= MIN_TEXTURED_PATCHES) {
    if (patches.matched.length < Math.max(3, Math.ceil(patches.textured / 2))) {
      return { kind: 'weak' };
    }
    const motion = bedMotionFromPatches({
      lens,
      pose,
      ...thumb,
      patches: patches.matched,
      bedWidthMm,
      bedHeightMm,
    });
    return motion === null
      ? { kind: 'weak' }
      : { kind: 'measured', displacementsMm: motion.displacementsMm, worstMm: motion.worstMm };
  }
  const shift = measureViewShift(reference, current, mask);
  if (shift === null) return { kind: 'none' };
  if (shift.score < MIN_MATCH_SCORE) return { kind: 'weak' };
  const offset = surroundShiftOnBedMm({
    lens,
    pose,
    ...thumb,
    mask,
    dxPx: shift.dxPx,
    dyPx: shift.dyPx,
  });
  if (offset === null) return { kind: 'none' };
  return {
    kind: 'measured',
    displacementsMm: bedSamplePoints(bedWidthMm, bedHeightMm).map(() => offset),
    worstMm: Math.hypot(offset.x, offset.y),
  };
}
