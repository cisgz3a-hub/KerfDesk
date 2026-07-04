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
//      naive 128 cutoff under- or over-burns.
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

// ITU-R BT.601 luma weights. Matches thresholdToMonochrome in
// trace-image.ts so the threshold cutoff is consistent regardless
// of which preprocessing stages run.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

function lumaAt(data: Uint8ClampedArray, pixelOffset: number): number {
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

// AUTO median gate: measures salt-and-pepper (impulse) noise as the fraction
// of pixels the 3×3 median would move by more than IMPULSE_NOISE_LUMA_DELTA
// luma, and returns whether that fraction clears IMPULSE_NOISE_MIN_RATIO.
// WHY: a median destroys clean small glyphs — 4-6 px letters trace as melted
// blobs — so it must only run when the image genuinely carries impulse noise
// that the median repairs. Both the Edge Detection tracer and the Smooth
// trace preset gate on this instead of forcing the median unconditionally.
//
// Moved here from edge-trace.ts so the two callers share one detector and one
// set of constants (values unchanged from the original edge implementation).
const IMPULSE_NOISE_LUMA_DELTA = 40;
export const IMPULSE_NOISE_MIN_RATIO = 0.004;

export function hasImpulseNoise(image: RawImageData): boolean {
  const filtered = medianFilter(image);
  return impulseNoiseRatio(image, filtered) >= IMPULSE_NOISE_MIN_RATIO;
}

// Fraction of pixels whose luma the median changed by more than the impulse
// delta. Takes the pre-computed median-filtered image so callers that also
// need the filtered result (Edge Detection, the 'auto' trace path) do not
// compute the median twice.
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
// that minimises misclassification. Far better than the fixed-128
// default for images shot under uneven lighting or with a coloured
// background.
//
// Implementation follows the cumulative-sum form (linear in pixel
// count + 256 histogram passes). Returns a value in [0, 255].
export function otsuThreshold(image: RawImageData): number {
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const luma = lumaAt(image.data, i);
    hist[luma] = (hist[luma] ?? 0) + 1;
    total += 1;
  }
  if (total === 0) return 128;
  let sumTotal = 0;
  for (let t = 0; t < 256; t += 1) sumTotal += t * (hist[t] ?? 0);
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let bestT = 0;
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
    }
  }
  // bestT is the largest luma still classified as ink. thresholdToMonochrome
  // uses `luma >= cutoff` to mean "background"; we want pixels with luma
  // <= bestT to be ink and pixels with luma > bestT to be background. The
  // cutoff that satisfies that is bestT + 1. Clamp at 255 just in case
  // (degenerate inputs where everything is at 255 already).
  return Math.min(255, bestT + 1);
}

// Connected-component despeckle on a binary (or near-binary) image.
// For each region of ink pixels (luma < 128) with size < minPixels,
// flips the whole region to white. Background regions are untouched
// because the operator's intent is "remove tiny dots", not "remove
// tiny holes" — preserving hole topology is critical for letters
// like O / B / R / etc.
//
// BFS using a single Uint8 visited mask + an index queue. O(N) total
// work for N pixels regardless of region count.
export function despeckle(image: RawImageData, minPixels: number): RawImageData {
  if (minPixels <= 1) return image;
  const { width: w, height: h } = image;
  const out = new Uint8ClampedArray(image.data);
  const visited = new Uint8Array(w * h);
  for (let startIdx = 0; startIdx < w * h; startIdx += 1) {
    if (visited[startIdx] !== 0) continue;
    visited[startIdx] = 1;
    if (lumaAt(out, startIdx * 4) >= 128) continue; // background pixel — skip
    const region = bfsInkRegion(out, visited, w, h, startIdx);
    if (region.length < minPixels) {
      eraseRegion(out, region);
    }
  }
  return { width: w, height: h, data: out };
}

// BFS the connected ink region (luma < 128) starting at `startIdx`.
// Marks every visited cell in `visited`. 4-connected so diagonal-only
// touches stay separate regions — matches what the eye reads as
// "this dot is detached".
function bfsInkRegion(
  out: Uint8ClampedArray,
  visited: Uint8Array,
  w: number,
  h: number,
  startIdx: number,
): number[] {
  const region: number[] = [startIdx];
  const queue: number[] = [startIdx];
  while (queue.length > 0) {
    const cur = queue.pop() ?? 0;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    visitNeighbour(out, visited, w, h, cx - 1, cy, region, queue);
    visitNeighbour(out, visited, w, h, cx + 1, cy, region, queue);
    visitNeighbour(out, visited, w, h, cx, cy - 1, region, queue);
    visitNeighbour(out, visited, w, h, cx, cy + 1, region, queue);
  }
  return region;
}

function visitNeighbour(
  out: Uint8ClampedArray,
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
  if (lumaAt(out, ni * 4) < 128) {
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
