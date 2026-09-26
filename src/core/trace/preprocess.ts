// Image preprocessing pipeline applied BEFORE imagetracerjs sees the
// pixels. Better preprocessing buys far more trace quality than
// chasing alternate libraries — speckle, broken lines, and edge
// jaggies usually come from the input, not the tracer.
//
// Three stages, each a pure function over RawImageData. Compose them
// in trace-image.ts based on TraceOptions flags:
//
//   1. medianFilter — 3×3 median replaces salt-and-pepper noise
//      with the dominant neighbour. JPEG artefacts and scanner
//      speckle largely disappear.
//   2. otsuThreshold — picks the optimal binary cutoff from the
//      image's luma histogram by maximising between-class variance
//      (Otsu, 1979). Auto-adapts to bright/dark sources where the
//      naive 128 cutoff under- or over-burns. otsuSeparation also
//      reports Otsu's separability measure (η), which the uneven-
//      lighting fallback in background-flatten.ts compares.
//   3. despeckle — connected-component flood fills the binarised
//      image and removes ink regions smaller than `minPixels`. Kills
//      the tiny black dots imagetracerjs invents on JPEG artefacts.
//
// Algorithm references:
//   - Otsu's method: N. Otsu, "A Threshold Selection Method from
//     Gray-Level Histograms", IEEE Trans. Sys. Man. Cyber. 9 (1979).
//     Public-domain math; we implement from the paper.
//   - Median filter: classic image-processing primitive, public
//     domain math.
//   - Connected-component despeckle: textbook flood-fill, public
//     domain.
//
// No code copied from any library — all three are written here from
// the paper/algorithm description, satisfying ADR-017.
//
// Pure-core compliant: no clock, no random, no I/O.

import type { RawImageData } from './trace-image';
import { medianSourceOverPaper, repairIsolatedMedianChanges } from './auto-median';
import {
  createSaddleResolver,
  type SaddlePolicyInput,
  type SaddleResolver,
} from './saddle-connectivity';

// ITU-R BT.601 luma weights. Matches thresholdToMonochrome in
// trace-image.ts so the threshold cutoff is consistent regardless
// of which preprocessing stages run.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

export function lumaAt(data: Uint8ClampedArray, pixelOffset: number): number {
  const r = data[pixelOffset] ?? 0;
  const g = data[pixelOffset + 1] ?? 0;
  const b = data[pixelOffset + 2] ?? 0;
  return Math.round(LUMA_R * r + LUMA_G * g + LUMA_B * b);
}

// Maximum 3×3 neighbourhood size; the reusable scratch buffer is sized once.
const MEDIAN_WINDOW = 9;

// 3×3 median filter. For each pixel, replace its luma with the
// median of its 3×3 neighbourhood. Output is greyscale (R=G=B). Edge
// pixels use the available neighbours only (no edge padding tricks —
// cleaner than introducing artificial values).
//
// Performance: the previous implementation allocated a fresh Array and
// invoked a comparator sort PER PIXEL — ~1M allocations + JS sorts on a
// 1024² image, which dominated the Smooth preset's runtime. This version
// is allocation-free: a single reusable scratch buffer holds the samples,
// interior pixels (the full 9-sample case) use a fixed sorting network that
// stops as soon as the middle element is known, and border pixels (< 9
// samples) fall back to an insertion sort over the same buffer. Output is
// byte-identical to the naive gather-sort-middle median for every input.
export function medianFilter(image: RawImageData): RawImageData {
  const { width: w, height: h, data } = image;
  const out = new Uint8ClampedArray(w * h * 4);
  // Reused for every pixel — no per-pixel allocation.
  const buf = new Uint8Array(MEDIAN_WINDOW);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          buf[count] = lumaAt(data, (ny * w + nx) * 4);
          count += 1;
        }
      }
      const median = count === MEDIAN_WINDOW ? median9(buf) : medianByInsertion(buf, count);
      const pi = (y * w + x) * 4;
      out[pi] = median;
      out[pi + 1] = median;
      out[pi + 2] = median;
      out[pi + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

// Median of the first `count` (< 9) samples in `buf` via in-place insertion
// sort — cheap for the tiny border neighbourhoods (3, 4, or 6 samples) and
// allocation-free. Returns buf[count >> 1], matching the naive median's
// "middle of the sorted list" for these odd/even small counts.
function medianByInsertion(buf: Uint8Array, count: number): number {
  for (let i = 1; i < count; i += 1) {
    const v = buf[i] ?? 0;
    let j = i - 1;
    while (j >= 0 && (buf[j] ?? 0) > v) {
      buf[j + 1] = buf[j] ?? 0;
      j -= 1;
    }
    buf[j + 1] = v;
  }
  return buf[count >> 1] ?? 0;
}

// Median of exactly 9 samples via the classic 19-compare median-of-9 sorting
// network (Smith, "Implementing median filters in XC4000E FPGAs", 1996). It
// does NOT fully sort the 9 values — it just guarantees the median lands at
// index 4 — so it is cheaper than a full sort while producing byte-identical
// results to "sort all 9, take the middle" for every input.
function median9(buf: Uint8Array): number {
  swapSort(buf, 1, 2);
  swapSort(buf, 4, 5);
  swapSort(buf, 7, 8);
  swapSort(buf, 0, 1);
  swapSort(buf, 3, 4);
  swapSort(buf, 6, 7);
  swapSort(buf, 1, 2);
  swapSort(buf, 4, 5);
  swapSort(buf, 7, 8);
  swapSort(buf, 0, 3);
  swapSort(buf, 5, 8);
  swapSort(buf, 4, 7);
  swapSort(buf, 3, 6);
  swapSort(buf, 1, 4);
  swapSort(buf, 2, 5);
  swapSort(buf, 4, 7);
  swapSort(buf, 4, 2);
  swapSort(buf, 6, 4);
  swapSort(buf, 4, 2);
  return buf[4] ?? 0;
}

// Compare-and-swap the two buffer slots into ascending order — the single
// primitive a sorting network is built from.
function swapSort(buf: Uint8Array, i: number, j: number): void {
  const a = buf[i] ?? 0;
  const b = buf[j] ?? 0;
  if (a > b) {
    buf[i] = b;
    buf[j] = a;
  }
}

// AUTO cleanup measures isolated high-contrast impulses. A full-frame median
// also erases coherent one-pixel strokes, so automatic repair applies only to
// isolated changed pixels, preserving connected features even in noisy art.
const IMPULSE_NOISE_LUMA_DELTA = 40;
export const IMPULSE_NOISE_MIN_RATIO = 0.004;

export function hasImpulseNoise(image: RawImageData): boolean {
  return autoMedianFilter(image) !== image;
}

/** Selective automatic cleanup; computes the median only once. An explicit
 * medianFilter:true keeps using the full median's historical behaviour.
 * `minimumRatio` 0 repairs every isolated impulse: a crop whose whole source
 * already crossed the density floor (ADR-436). */
export function autoMedianFilter(
  image: RawImageData,
  minimumRatio = IMPULSE_NOISE_MIN_RATIO,
): RawImageData {
  const filtered = medianFilter(medianSourceOverPaper(image));
  return repairIsolatedMedianChanges(image, filtered, IMPULSE_NOISE_LUMA_DELTA, minimumRatio);
}

// Fraction of pixels whose luma the median changed by more than the impulse
// delta, without distinguishing connected detail from isolated noise. Retained
// as a raw diagnostic metric; automatic cleanup uses the structural check above.
//
// Uses UN-rounded luma (not the module's rounded lumaAt) on purpose: the
// original edge-trace impulse detector compared un-rounded luma, and the
// > 40 delta test can flip on rounding at the boundary. Preserving the exact
// arithmetic keeps Edge Detection's AUTO decision bit-identical after the
// move.
export function impulseNoiseRatio(image: RawImageData, filtered: RawImageData): number {
  const pixels = image.width * image.height;
  if (pixels === 0) return 0;
  let impulses = 0;
  for (let i = 0; i < pixels; i += 1) {
    const a = rawLumaAt(image.data, i * 4);
    const b = rawLumaAt(filtered.data, i * 4);
    if (Math.abs(a - b) > IMPULSE_NOISE_LUMA_DELTA) impulses += 1;
  }
  return impulses / pixels;
}

function rawLumaAt(data: Uint8ClampedArray, pixelOffset: number): number {
  return (
    LUMA_R * (data[pixelOffset] ?? 0) +
    LUMA_G * (data[pixelOffset + 1] ?? 0) +
    LUMA_B * (data[pixelOffset + 2] ?? 0)
  );
}

// Otsu's method: returns the luma cutoff that maximises the
// between-class variance of the source's histogram. For bimodal
// inputs (a clear foreground + background) the result is the optimal
// binary threshold; for unimodal inputs it picks a sensible boundary
// that minimises misclassification. A single global cut cannot follow
// uneven lighting; background-flatten.ts handles that case before this
// runs (see otsuBinarization).
//
// Implementation follows the cumulative-sum form (linear in pixel
// count + 256 histogram passes). Returns a value in [0, 255].
export function otsuThreshold(image: RawImageData): number {
  return otsuSeparation(image).threshold;
}

export type OtsuSeparation = {
  /** Cutoff in thresholdToMonochrome's convention: luma < threshold is ink. */
  readonly threshold: number;
  /** Otsu's separability η = σ²_between / σ²_total at the chosen cut, in
   *  [0, 1]; 0 for a single-valued image. Near 1 means two tight, well
   *  separated populations; a smooth ramp split in two scores about 0.75. */
  readonly separability: number;
  /** Mean luma above the cut minus mean luma below it. */
  readonly contrast: number;
};

/** Otsu's cut plus the goodness measures defined by Otsu (1979), computed from
 *  one histogram pass. The threshold is identical to otsuThreshold. */
export function otsuSeparation(image: RawImageData): OtsuSeparation {
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const luma = lumaAt(image.data, i);
    hist[luma] = (hist[luma] ?? 0) + 1;
    total += 1;
  }
  if (total === 0) return { threshold: 128, separability: 0, contrast: 0 };
  return otsuFromHistogram(hist, total);
}

function otsuFromHistogram(hist: Uint32Array, total: number): OtsuSeparation {
  let sumTotal = 0;
  for (let t = 0; t < 256; t += 1) sumTotal += t * (hist[t] ?? 0);
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let bestT = 0;
  let contrast = 0;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t] ?? 0;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * (hist[t] ?? 0);
    const mB = sumB / wB;
    const mF = (sumTotal - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar) {
      maxVar = varBetween;
      bestT = t;
      contrast = mF - mB;
    }
  }
  // bestT is the largest luma still classified as ink. thresholdToMonochrome
  // uses `luma >= cutoff` to mean "background"; we want pixels with luma
  // <= bestT to be ink and pixels with luma > bestT to be background. The
  // cutoff that satisfies that is bestT + 1. Clamp at 255 just in case
  // (degenerate inputs where everything is at 255 already).
  const threshold = Math.min(255, bestT + 1);
  const spread = totalScatter(hist, sumTotal / total);
  // varBetween is wB·wF·Δ² in counts; σ²_between/σ²_total = it / (N · scatter).
  const separability = spread === 0 ? 0 : Math.min(1, maxVar / (total * spread));
  return { threshold, separability, contrast };
}

// Σ count·(luma − mean)², the histogram's total scatter.
function totalScatter(hist: Uint32Array, mean: number): number {
  let scatter = 0;
  for (let t = 0; t < 256; t += 1) scatter += (hist[t] ?? 0) * (t - mean) * (t - mean);
  return scatter;
}

// Connected-component despeckle on a binary (or near-binary) image.
// For each region of ink pixels (luma < 128) with size < minPixels,
// flips the whole region to white. Background regions are untouched
// because the operator's intent is "remove tiny dots", not "remove
// tiny holes" — preserving hole topology is critical for letters
// like O / B / R / etc.
//
// Connectivity must match the stage that consumes the mask. Centerline opts
// into eight-connectivity so a diagonal stroke is one component rather than a
// row of isolated specks. Contours pass their saddle policy instead
// (saddle-connectivity.ts): two diagonally-touching ink pixels are one
// region exactly when the contour walker will trace them as one loop, so a
// 1-px diagonal hairline the walker keeps is never erased pixel by pixel.
// Plain 4 remains the historical four-connected rule.
// BFS using a single Uint8 visited mask + an index queue. O(N) total
// work for N pixels regardless of region count.
//
// judge (the automatic small-mark policy, small-mark-policy.ts): when given,
// a region under minPixels is erased only if the judge rejects it. It sees
// the mask as it was BEFORE any erasure, so the result does not depend on
// scan order.
export function despeckle(
  image: RawImageData,
  minPixels: number,
  connectivity: 4 | 8 | SaddlePolicyInput = 4,
  judge?: InkMarkJudge,
): RawImageData {
  if (minPixels <= 1) return image;
  const { width: w, height: h } = image;
  const out = new Uint8ClampedArray(image.data);
  const visited = new Uint8Array(w * h);
  const ink = binaryInk(image);
  const diagonal = diagonalLinks(image, ink, connectivity);
  for (let startIdx = 0; startIdx < w * h; startIdx += 1) {
    if (visited[startIdx] !== 0) continue;
    visited[startIdx] = 1;
    if (ink[startIdx] !== 1) continue; // background pixel — skip
    const region = bfsInkRegion(ink, visited, w, h, startIdx, diagonal);
    if (region.length < minPixels && judge?.(region, ink) !== true) {
      eraseRegion(out, region);
    }
  }
  return { width: w, height: h, data: out };
}

/** true = keep this sub-threshold ink region. `ink` is the pre-erasure mask. */
export type InkMarkJudge = (region: ReadonlyArray<number>, ink: Uint8Array) => boolean;

function binaryInk(image: RawImageData): Uint8Array {
  const ink = new Uint8Array(image.width * image.height);
  for (let i = 0; i < ink.length; i += 1) ink[i] = lumaAt(image.data, i * 4) < 128 ? 1 : 0;
  return ink;
}

// Which diagonal ink steps join a region: none (4), all (8), or those whose
// saddle corner the contour policy resolves in favour of ink. A diagonal
// step whose corner is NOT a saddle (one of the two in-between pixels is
// ink) is always allowed — those pixels are four-connected through it.
type DiagonalLinks =
  | 'none'
  | 'all'
  | { readonly ink: Uint8Array; readonly saddles: SaddleResolver };

function diagonalLinks(
  image: RawImageData,
  ink: Uint8Array,
  connectivity: 4 | 8 | SaddlePolicyInput,
): DiagonalLinks {
  if (connectivity === 4) return 'none';
  if (connectivity === 8) return 'all';
  const mask = { width: image.width, height: image.height, ink };
  const saddles = createSaddleResolver(
    mask,
    connectivity.turnPolicy,
    connectivity.field,
    connectivity.pixelScale,
  );
  return { ink, saddles };
}

// BFS the connected ink region (luma < 128) starting at `startIdx`.
// Marks every visited cell in `visited`.
function bfsInkRegion(
  ink: Uint8Array,
  visited: Uint8Array,
  w: number,
  h: number,
  startIdx: number,
  diagonal: DiagonalLinks,
): number[] {
  const region: number[] = [startIdx];
  const queue: number[] = [startIdx];
  while (queue.length > 0) {
    const cur = queue.pop() ?? 0;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    visitNeighbour(ink, visited, w, h, cx - 1, cy, region, queue);
    visitNeighbour(ink, visited, w, h, cx + 1, cy, region, queue);
    visitNeighbour(ink, visited, w, h, cx, cy - 1, region, queue);
    visitNeighbour(ink, visited, w, h, cx, cy + 1, region, queue);
    if (diagonal === 'none') continue;
    for (const [sx, sy] of DIAGONAL_STEPS) {
      if (!diagonalStepJoins(diagonal, w, cx, cy, sx, sy)) continue;
      visitNeighbour(ink, visited, w, h, cx + sx, cy + sy, region, queue);
    }
  }
  return region;
}

const DIAGONAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

function diagonalStepJoins(
  diagonal: DiagonalLinks,
  w: number,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
): boolean {
  if (diagonal === 'all') return true;
  if (diagonal === 'none') return false;
  const nx = cx + sx;
  const ny = cy + sy;
  // Out-of-image targets are rejected by visitNeighbour; the in-between
  // pixels of an in-image target are always in the image.
  if (nx < 0 || nx >= w || ny < 0 || ny * w >= diagonal.ink.length) return false;
  if ((diagonal.ink[cy * w + nx] ?? 0) === 1 || (diagonal.ink[ny * w + cx] ?? 0) === 1) return true;
  return diagonal.saddles(Math.max(cx, nx), Math.max(cy, ny));
}

function visitNeighbour(
  ink: Uint8Array,
  visited: Uint8Array,
  w: number,
  h: number,
  nx: number,
  ny: number,
  region: number[],
  queue: number[],
): void {
  if (nx < 0 || nx >= w || ny < 0 || ny >= h) return;
  const ni = ny * w + nx;
  if (visited[ni] !== 0) return;
  visited[ni] = 1;
  if (ink[ni] === 1) {
    region.push(ni);
    queue.push(ni);
  }
}

function eraseRegion(out: Uint8ClampedArray, region: ReadonlyArray<number>): void {
  for (const r of region) {
    const ri = r * 4;
    out[ri] = 255;
    out[ri + 1] = 255;
    out[ri + 2] = 255;
    out[ri + 3] = 255;
  }
}
