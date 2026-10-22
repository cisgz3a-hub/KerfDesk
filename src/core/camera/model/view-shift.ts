// Has the camera moved since it was last known to be right? (ADR-663
// Amendment 3) What a fixed camera sees around the bed (the machine's frame,
// its enclosure, the table) stays put while material comes and goes on the
// bed, so that view, shifted against a reference taken when the calibration was
// known good, shows a camera or lid that has moved. Edge maps are compared
// rather than brightness, so a light switched on does not read as a move. It
// only advises: a view it cannot match well enough says nothing. Pure core.

import type { RgbaImage } from '../rgba-image';
import { bedMapper, type CameraPose, type LensModel, type Vec2 } from './camera-model';

/** A small grey picture of the camera's whole view, 0..255 per pixel. */
export type ViewThumbnail = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

export type ViewShift = {
  /** How far the current view sits from the reference, thumbnail pixels. */
  readonly dxPx: number;
  readonly dyPx: number;
  /** Normalised correlation of the edges at the best shift, -1..1. */
  readonly score: number;
};

// About 2 mm of a 400 mm bed per pixel, read to a fraction of one: fine
// enough for a millimetre, small enough to keep on this computer.
export const THUMB_WIDTH = 384;
// The largest move looked for, thumbnail pixels: a knocked camera, not a new one.
export const MAX_SHIFT_PX = 16;
// The fine search around twice the half-size answer, thumbnail pixels.
const REFINE_PX = 2;
// The surround must be at least this share of the view to be worth comparing.
export const MIN_SURROUND_SHARE = 0.04;
// Below this the views do not match well enough to say anything.
export const MIN_MATCH_SCORE = 0.6;
// A shift this large on the bed is worth a warning.
export const MOVED_MM = 1;
// Kept clear around the bed's edge, mm: material often overhangs it a little.
const BED_EDGE_MARGIN_MM = 10;

/** Box-average `image` down to {@link THUMB_WIDTH} pixels across, keeping its shape. */
export function viewThumbnail(image: RgbaImage, width: number = THUMB_WIDTH): ViewThumbnail {
  const height = Math.max(1, Math.round((width * image.height) / image.width));
  const data = new Uint8Array(width * height);
  const sx = image.width / width;
  const sy = image.height / height;
  for (let ty = 0; ty < height; ty += 1) {
    const y0 = Math.floor(ty * sy);
    const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * sy));
    for (let tx = 0; tx < width; tx += 1) {
      const x0 = Math.floor(tx * sx);
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * sx));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * image.width + x) * 4;
          sum +=
            0.299 * (image.data[offset] ?? 0) +
            0.587 * (image.data[offset + 1] ?? 0) +
            0.114 * (image.data[offset + 2] ?? 0);
          count += 1;
        }
      }
      data[ty * width + tx] = Math.round(sum / count);
    }
  }
  return { width, height, data };
}

/**
 * Which thumbnail pixels see the surround: they map, through the camera
 * model, to the bed plane outside the bed and its edge margin. Pixels the
 * lens gives no ray are left out.
 */
export function surroundMask(args: {
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly thumbWidth: number;
  readonly thumbHeight: number;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
}): Uint8Array {
  const { thumbWidth, thumbHeight } = args;
  const toBed = bedMapper(args.lens, args.pose);
  const sx = args.lens.imageWidth / thumbWidth;
  const sy = args.lens.imageHeight / thumbHeight;
  const m = BED_EDGE_MARGIN_MM;
  const mask = new Uint8Array(thumbWidth * thumbHeight);
  for (let ty = 0; ty < thumbHeight; ty += 1) {
    for (let tx = 0; tx < thumbWidth; tx += 1) {
      const bed = toBed({ x: (tx + 0.5) * sx - 0.5, y: (ty + 0.5) * sy - 0.5 }, 0);
      if (bed === null) continue;
      const outside =
        bed.x < -m || bed.y < -m || bed.x > args.bedWidthMm + m || bed.y > args.bedHeightMm + m;
      if (outside) mask[ty * thumbWidth + tx] = 1;
    }
  }
  return mask;
}

/**
 * The shift of `current` against `reference` over the masked surround, or null
 * when the two cannot be compared or the surround is too small or too plain.
 */
export function measureViewShift(
  reference: ViewThumbnail,
  current: ViewThumbnail,
  mask: Uint8Array,
  maxShiftPx: number = MAX_SHIFT_PX,
): ViewShift | null {
  const { width, height } = reference;
  if (current.width !== width || current.height !== height || mask.length !== width * height) {
    return null;
  }
  let surround = 0;
  for (const value of mask) surround += value;
  if (surround < MIN_SURROUND_SHARE * width * height) return null;
  const fine: Grid = { a: edgeMap(reference), b: edgeMap(current), mask, width, height };
  // Half size first, over the whole range; then full size around its answer.
  const coarse = bestShift(halved(fine), Math.ceil(maxShiftPx / 2), { x: 0, y: 0 });
  if (coarse === null) return null;
  const found = bestShift(fine, REFINE_PX, { x: 2 * coarse.best.x, y: 2 * coarse.best.y });
  if (found === null) return null;
  // Correlation peaks lock towards whole pixels; a gradient step from the
  // best whole pixel does not.
  const step = gradientStep(fine, found.best);
  if (step === null) return found.shift;
  return { dxPx: found.best.x + step.x, dyPx: found.best.y + step.y, score: found.shift.score };
}

type Grid = {
  readonly a: Float32Array;
  readonly b: Float32Array;
  readonly mask: Uint8Array;
  readonly width: number;
  readonly height: number;
};

// The best whole-pixel shift within `reach` of `around`, refined to a fraction.
function bestShift(
  grid: Grid,
  reach: number,
  around: { readonly x: number; readonly y: number },
): { readonly best: { readonly x: number; readonly y: number }; readonly shift: ViewShift } | null {
  const side = 2 * reach + 1;
  const scores = new Float64Array(side * side).fill(Number.NaN);
  let best = { x: 0, y: 0, score: Number.NEGATIVE_INFINITY };
  for (let j = 0; j < side; j += 1) {
    for (let i = 0; i < side; i += 1) {
      const dx = around.x + i - reach;
      const dy = around.y + j - reach;
      const score = maskedCorrelation(grid, dx, dy);
      scores[j * side + i] = score;
      if (score > best.score) best = { x: dx, y: dy, score };
    }
  }
  if (!Number.isFinite(best.score)) return null;
  const at = (dx: number, dy: number): number => {
    const i = dx - around.x + reach;
    const j = dy - around.y + reach;
    return i < 0 || j < 0 || i >= side || j >= side
      ? Number.NaN
      : (scores[j * side + i] ?? Number.NaN);
  };
  const peak = quadraticPeak((i, j) => at(best.x + i, best.y + j));
  return {
    best: { x: best.x, y: best.y },
    shift: { dxPx: best.x + peak.x, dyPx: best.y + peak.y, score: best.score },
  };
}

// Half the size: edges averaged over 2 × 2 pixels, kept where most were surround.
function halved(grid: Grid): Grid {
  const width = Math.floor(grid.width / 2);
  const height = Math.floor(grid.height / 2);
  const a = new Float32Array(width * height);
  const b = new Float32Array(width * height);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = 2 * y * grid.width + 2 * x;
      const four = [i, i + 1, i + grid.width, i + grid.width + 1];
      let sa = 0;
      let sb = 0;
      let sm = 0;
      for (const k of four) {
        sa += grid.a[k] ?? 0;
        sb += grid.b[k] ?? 0;
        sm += grid.mask[k] ?? 0;
      }
      a[y * width + x] = sa / 4;
      b[y * width + x] = sb / 4;
      mask[y * width + x] = sm >= 3 ? 1 : 0;
    }
  }
  return { a, b, mask, width, height };
}

/**
 * How far a view shift moves the middle of the bed, mm: the bed centre's pixel
 * shifted by it, mapped back onto the bed. Null when the model gives no ray.
 */
export function viewShiftOnBedMm(args: {
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly thumbWidth: number;
  readonly thumbHeight: number;
  readonly bedCentreMm: Vec2;
  readonly centrePx: Vec2;
  readonly shift: ViewShift;
}): number | null {
  const toBed = bedMapper(args.lens, args.pose);
  const sx = args.lens.imageWidth / args.thumbWidth;
  const sy = args.lens.imageHeight / args.thumbHeight;
  const moved = toBed(
    { x: args.centrePx.x + args.shift.dxPx * sx, y: args.centrePx.y + args.shift.dyPx * sy },
    0,
  );
  if (moved === null) return null;
  return Math.hypot(moved.x - args.bedCentreMm.x, moved.y - args.bedCentreMm.y);
}

// Sobel gradient magnitude; the one-pixel border stays zero.
function edgeMap(thumb: ViewThumbnail): Float32Array {
  const { width, height, data } = thumb;
  const out = new Float32Array(width * height);
  const p = (x: number, y: number): number => data[y * width + x] ?? 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const gx =
        p(x + 1, y - 1) +
        2 * p(x + 1, y) +
        p(x + 1, y + 1) -
        p(x - 1, y - 1) -
        2 * p(x - 1, y) -
        p(x - 1, y + 1);
      const gy =
        p(x - 1, y + 1) +
        2 * p(x, y + 1) +
        p(x + 1, y + 1) -
        p(x - 1, y - 1) -
        2 * p(x, y - 1) -
        p(x + 1, y - 1);
      out[y * width + x] = Math.hypot(gx, gy);
    }
  }
  return out;
}

// Normalised cross-correlation of reference pixels p (masked) with current
// pixels p + (dx, dy), over the pairs that stay inside the picture.
function maskedCorrelation(grid: Grid, dx: number, dy: number): number {
  const { a, b, mask, width, height } = grid;
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let y = Math.max(0, -dy); y < Math.min(height, height - dy); y += 1) {
    for (let x = Math.max(0, -dx); x < Math.min(width, width - dx); x += 1) {
      const i = y * width + x;
      if (mask[i] !== 1) continue;
      const va = a[i] ?? 0;
      const vb = b[(y + dy) * width + x + dx] ?? 0;
      n += 1;
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
    }
  }
  if (n < 2) return Number.NEGATIVE_INFINITY;
  const cov = sab - (sa * sb) / n;
  const varA = saa - (sa * sa) / n;
  const varB = sbb - (sb * sb) / n;
  if (!(varA > 0) || !(varB > 0)) return Number.NEGATIVE_INFINITY;
  return cov / Math.sqrt(varA * varB);
}

// One Lucas-Kanade step on the normalised edge maps over the surround: the
// sub-pixel (u, v) that best explains current(p + best + (u, v)) = reference(p),
// to first order. Null when the surround has too little edge structure.
function gradientStep(
  grid: Grid,
  best: { readonly x: number; readonly y: number },
): { x: number; y: number } | null {
  const { a, b, width } = grid;
  const pairs = surroundPairs(grid, best);
  if (pairs.length < 16) return null;
  const offset = best.y * width + best.x;
  const sa = meanAndSpread(a, pairs, 0);
  const sb = meanAndSpread(b, pairs, offset);
  let gxx = 0;
  let gxy = 0;
  let gyy = 0;
  let hx = 0;
  let hy = 0;
  for (const i of pairs) {
    const j = i + offset;
    const gx = ((b[j + 1] ?? 0) - (b[j - 1] ?? 0)) / (2 * sb.std);
    const gy = ((b[j + width] ?? 0) - (b[j - width] ?? 0)) / (2 * sb.std);
    const r = ((b[j] ?? 0) - sb.mean) / sb.std - ((a[i] ?? 0) - sa.mean) / sa.std;
    gxx += gx * gx;
    gxy += gx * gy;
    gyy += gy * gy;
    hx += gx * r;
    hy += gy * r;
  }
  const det = gxx * gyy - gxy * gxy;
  if (!(det > 1e-9 * (gxx + gyy) ** 2) || !Number.isFinite(det)) return null;
  const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
  // Solve G·(u, v) = -h.
  return { x: clamp((-gyy * hx + gxy * hy) / det), y: clamp((gxy * hx - gxx * hy) / det) };
}

// The surround pixels whose shifted partner, and its four neighbours, are in the picture.
function surroundPairs(grid: Grid, best: { readonly x: number; readonly y: number }): number[] {
  const { mask, width, height } = grid;
  const pairs: number[] = [];
  for (let y = Math.max(1, 1 - best.y); y < Math.min(height - 1, height - 1 - best.y); y += 1) {
    for (let x = Math.max(1, 1 - best.x); x < Math.min(width - 1, width - 1 - best.x); x += 1) {
      if (mask[y * width + x] === 1) pairs.push(y * width + x);
    }
  }
  return pairs;
}

function meanAndSpread(
  values: Float32Array,
  pairs: ReadonlyArray<number>,
  shift: number,
): { readonly mean: number; readonly std: number } {
  let sum = 0;
  let squares = 0;
  for (const i of pairs) {
    const v = values[i + shift] ?? 0;
    sum += v;
    squares += v * v;
  }
  const mean = sum / pairs.length;
  return { mean, std: Math.sqrt(Math.max(squares / pairs.length - mean * mean, 1e-12)) };
}

// The sub-pixel peak of the scores around a whole-pixel best, from a 2-D
// quadratic fitted to its 3 × 3 neighbourhood. A diagonal surround tilts the
// peak, which separate x and y parabolas would misread. Falls back to them at
// the edge of the search, where a neighbour is missing.
function quadraticPeak(score: (i: number, j: number) => number): { x: number; y: number } {
  let sum = 0;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let j = -1; j <= 1; j += 1) {
    for (let i = -1; i <= 1; i += 1) {
      const v = score(i, j);
      if (!Number.isFinite(v)) {
        return {
          x: parabolaPeak(score(-1, 0), score(0, 0), score(1, 0)),
          y: parabolaPeak(score(0, -1), score(0, 0), score(0, 1)),
        };
      }
      sum += v;
      sx += i * v;
      sy += j * v;
      sxy += i * j * v;
      sxx += (3 * i * i - 2) * v;
      syy += (3 * j * j - 2) * v;
    }
  }
  // Least-squares a + b·x + c·y + d·x² + e·x·y + f·y² on the 3 × 3 grid.
  const b = sx / 6;
  const c = sy / 6;
  const d = sxx / 6;
  const e = sxy / 4;
  const f = syy / 6;
  const det = 4 * d * f - e * e;
  if (!(d < 0) || !(f < 0) || !(det > 0) || !Number.isFinite(sum)) return { x: 0, y: 0 };
  const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
  return { x: clamp((-2 * f * b + e * c) / det), y: clamp((-2 * d * c + e * b) / det) };
}

// The sub-pixel offset of a peak from its two neighbours' scores, -0.5..0.5.
function parabolaPeak(left: number, centre: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
  const denominator = left - 2 * centre + right;
  if (denominator >= 0) return 0;
  return Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denominator));
}
