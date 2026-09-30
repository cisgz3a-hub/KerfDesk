// Exact squared Euclidean distance to background for every ink pixel —
// two-pass separable lower-envelope transform (Felzenszwalb & Huttenlocher).
// The distance field is the backbone of the centerline rewrite: thinning
// order, spur budgets, and tip extension all read the local stroke radius
// from here. Distances are exact integers (squared), so the thinning bucket
// queue can key on them directly.

import { runTraceSteps, type TraceSteps } from '../trace-steps';

const INF = Number.MAX_SAFE_INTEGER;
// In-column run length meaning "no background pixel seen yet".
const NO_BACKGROUND = 0x7fffffff;

export type InkMask = {
  readonly width: number;
  readonly height: number;
  /** 1 = ink, 0 = background. Length width*height. */
  readonly ink: Uint8Array;
};

/** distSq[i] = exact squared distance from pixel centre i to the nearest
 *  background pixel centre; 0 for background pixels. Everything OUTSIDE the
 *  image counts as background, so ink flush against the border keeps a
 *  finite, border-clamped radius — without this, a fully-ink image gets
 *  near-infinite distances and every radius-scaled stage downstream (spur
 *  budgets, tip-extension walk length, artifact-loop rejection) blows up. */
export function squaredDistanceField(mask: InkMask): Float64Array {
  return runTraceSteps(squaredDistanceFieldSteps(mask));
}

export function* squaredDistanceFieldSteps(mask: InkMask): TraceSteps<Float64Array> {
  const cooperate = yield;
  const { width, height } = mask;
  const distSq = new Float64Array(width * height);
  // Pass 1, the column transform of the 0/INF indicator. Its lower envelope
  // over background parabolas (all rooted at 0) is exactly the squared
  // in-column distance to the nearest background pixel (INF when the column
  // has none), so two row-major integer sweeps give the same values without
  // the strided per-column envelope (ADR-438 amendment, speed wave 2).
  const run = new Int32Array(width);
  run.fill(NO_BACKGROUND);
  for (let y = 0; y < height; y += 1) {
    if (cooperate) yield;
    sweepDownRow(mask, y, run, distSq);
  }
  run.fill(NO_BACKGROUND);
  for (let y = height - 1; y >= 0; y -= 1) {
    if (cooperate) yield;
    sweepUpRow(mask, y, run, distSq);
  }
  // Pass 2: per-row 1D transform of the column result.
  const scratch = envelopeScratch(width);
  const row = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    if (cooperate) yield;
    transformRow(distSq, width, height, y, row, scratch);
  }
  return distSq;
}

// Down sweep: pixels since the last background pixel above, per column.
function sweepDownRow(
  { width, ink }: InkMask,
  y: number,
  run: Int32Array,
  distSq: Float64Array,
): void {
  const rowStart = y * width;
  for (let x = 0; x < width; x += 1) {
    const i = rowStart + x;
    if (ink[i] === 1) {
      const above = run[x] as number;
      const next = above === NO_BACKGROUND ? NO_BACKGROUND : above + 1;
      run[x] = next;
      distSq[i] = next;
    } else {
      run[x] = 0;
    }
  }
}

// Up sweep: the nearer of the background above and below, squared.
function sweepUpRow(
  { width, ink }: InkMask,
  y: number,
  run: Int32Array,
  distSq: Float64Array,
): void {
  const rowStart = y * width;
  for (let x = 0; x < width; x += 1) {
    const i = rowStart + x;
    if (ink[i] === 1) {
      const below = run[x] as number;
      const next = below === NO_BACKGROUND ? NO_BACKGROUND : below + 1;
      run[x] = next;
      const above = distSq[i] as number;
      const nearest = above < next ? above : next;
      distSq[i] = nearest === NO_BACKGROUND ? INF : nearest * nearest;
    } else {
      run[x] = 0;
    }
  }
}

// Row envelope of one row, with the virtual border clamp folded into the
// write-back. The 1D passes only see in-image background, so the first ring
// of pixels OUTSIDE the image also counts as background: pixel (x, y) is at
// most min(x+1, width-x, y+1, height-y) from it.
function transformRow(
  distSq: Float64Array,
  width: number,
  height: number,
  y: number,
  row: Float64Array,
  scratch: EnvelopeScratch,
): void {
  const rowStart = y * width;
  for (let x = 0; x < width; x += 1) {
    row[x] = distSq[rowStart + x] as number;
  }
  const transformed = distanceTransform1d(row, width, scratch);
  const yEdge = Math.min(y + 1, height - y);
  for (let x = 0; x < width; x += 1) {
    const edge = Math.min(x + 1, width - x, yEdge);
    const edgeSq = edge * edge;
    const value = transformed[x] as number;
    distSq[rowStart + x] = value > edgeSq ? edgeSq : value;
  }
}

// Working arrays for 1D transforms of up to `size` samples.
type EnvelopeScratch = {
  readonly v: Int32Array; // parabola roots
  readonly z: Float64Array; // envelope boundaries
  readonly d: Float64Array; // sampled result
};

function envelopeScratch(size: number): EnvelopeScratch {
  return { v: new Int32Array(size), z: new Float64Array(size + 1), d: new Float64Array(size) };
}

// 1D squared-distance transform via the lower envelope of parabolas
// rooted at (i, f[i]). The result lives in the scratch until the next call.
function distanceTransform1d(f: Float64Array, n: number, scratch: EnvelopeScratch): Float64Array {
  buildLowerEnvelope(f, n, scratch);
  return sampleEnvelope(f, n, scratch);
}

function buildLowerEnvelope(f: Float64Array, n: number, scratch: EnvelopeScratch): void {
  const { v, z } = scratch;
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    const fq = f[q] ?? 0;
    if (fq === INF && (f[v[k] ?? 0] ?? 0) === INF) {
      continue; // both at infinity — parabola intersection is undefined; skip
    }
    let s = intersection(f, q, v[k] ?? 0);
    while (k > 0 && s <= (z[k] ?? 0)) {
      k -= 1;
      s = intersection(f, q, v[k] ?? 0);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
}

function sampleEnvelope(f: Float64Array, n: number, scratch: EnvelopeScratch): Float64Array {
  const { v, z, d } = scratch;
  let k = 0;
  for (let q = 0; q < n; q += 1) {
    while ((z[k + 1] ?? Infinity) < q) k += 1;
    const root = v[k] ?? 0;
    const fr = f[root] ?? 0;
    d[q] = fr === INF ? INF : (q - root) * (q - root) + fr;
  }
  return d;
}

function intersection(f: Float64Array, q: number, p: number): number {
  const fq = f[q] ?? 0;
  const fp = f[p] ?? 0;
  if (fp === INF) return -Infinity; // q's parabola is below everywhere left
  if (fq === INF) return Infinity; // q never undercuts p
  return (fq + q * q - (fp + p * p)) / (2 * q - 2 * p);
}

/** Local stroke radius in pixels at index i (0 for background). */
export function radiusAt(distSq: Float64Array, index: number): number {
  return Math.sqrt(distSq[index] ?? 0);
}

/** Local stroke radius at a sub-pixel position, read bilinearly from the
 *  four pixel centres around it. `x`/`y` are image coordinates (pixel i
 *  covers [i, i + 1)), so a pixel centre reads exactly that pixel's radius.
 *  Outside the image reads as background, as the field itself treats it. */
export function interpolatedRadius(
  distSq: Float64Array,
  width: number,
  x: number,
  y: number,
): number {
  const height = width > 0 ? Math.floor(distSq.length / width) : 0;
  const gx = x - 0.5;
  const gy = y - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const at = (px: number, py: number): number =>
    px < 0 || py < 0 || px >= width || py >= height ? 0 : radiusAt(distSq, py * width + px);
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}
