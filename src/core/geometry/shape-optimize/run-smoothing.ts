// Gaussian smoothing of one run of an outline for Optimize Shapes (LBG-T22),
// without the shrinking plain Gaussian smoothing causes.
//
// The run is resampled every third of the smoothing distance along its length,
// each sample the average of the outline over its own stretch (a box filter,
// so noise finer than the spacing cannot alias into a false wave), and
// smoothed with a Gaussian kernel whose sigma is the smoothing distance along
// the outline, so the result does not depend on how densely the source was
// drawn.
//
// Plain Gaussian smoothing G pulls every curve inward: a circle of radius R
// shrinks by about sigma^2 / 2R. This uses Taubin's lambda|mu construction
// ("Curve and surface smoothing without shrinkage", ICCV 1995) with a full
// Gaussian step as the smoothing operator and lambda = 1, mu = -1: the
// smoothing step G is followed by an inflating step that adds back what G
// removes from the smoothed result, 2G - G*G. That is also Tukey's "twicing".
// Its response to a wave of the outline is 1 - (1 - g)^2 where g is the
// Gaussian's: wiggles shorter than about four smoothing distances are removed,
// and long curves keep their size to fourth order, so a circle shrinks by
// about sigma^4 / 4R^3 instead (0.0002 mm for sigma 0.5 mm on a 2 mm radius,
// against 0.06 mm plain).
//
// The resampling box is itself a small smoothing step (to fourth order a
// Gaussian of variance spacing^2 / 12), so it is counted in: G is applied as a
// Gaussian of variance sigma^2 - spacing^2 / 12 after the box, and G*G as one
// of variance 2 sigma^2 - spacing^2 / 12, so the box shrinks nothing either.
//
// The ends of an open run are corners or the ends of an open path: they are
// pinned, and the run is extended past them by point reflection (the extension
// continues the line through the end), which keeps a straight side straight
// right into its corner. A closed contour without corners wraps round.

import type { Vec2 } from '../../scene/scene-object';

const SAMPLES_PER_SIGMA = 3;
// Out to five sigmas the kernels keep all but 2e-5 of their variance, so the
// two steps' variances stay in the 2:1 ratio the no-shrink cancellation needs
// (cut at three sigmas they lose 3%, unevenly, and a circle shrinks again).
const KERNEL_REACH_SIGMAS = 5;
// Variance of a box one sample wide, in samples squared.
const BOX_VARIANCE = 1 / 12;

type Kernels = { readonly once: Float64Array; readonly twice: Float64Array };

export function smoothRun(points: ReadonlyArray<Vec2>, periodic: boolean, sigmaMm: number): Vec2[] {
  if (points.length < 3 || !(sigmaMm > 0)) return [...points];
  const walk = arcWalk(points, periodic);
  if (!(walk.total > 0)) return [...points];
  const count = Math.max(periodic ? 3 : 2, Math.ceil((walk.total * SAMPLES_PER_SIGMA) / sigmaMm));
  const spacing = walk.total / count;
  const sigmaSamples = sigmaMm / spacing;
  const kernels: Kernels = {
    once: gaussianKernel(Math.sqrt(sigmaSamples * sigmaSamples - BOX_VARIANCE)),
    twice: gaussianKernel(Math.sqrt(2 * sigmaSamples * sigmaSamples - BOX_VARIANCE)),
  };
  return periodic
    ? smoothPeriodic(boxSamples(walk, count, spacing, true), kernels)
    : smoothPinned(boxSamples(walk, count, spacing, false), kernels, points);
}

type ArcWalk = {
  readonly points: ReadonlyArray<Vec2>;
  readonly periodic: boolean;
  /** Arc length at each point; a periodic walk has one more entry, the full turn. */
  readonly at: Float64Array;
  /** Integral of x and y over arc length up to each point. */
  readonly ix: Float64Array;
  readonly iy: Float64Array;
  readonly total: number;
};

function arcWalk(points: ReadonlyArray<Vec2>, periodic: boolean): ArcWalk {
  const edges = periodic ? points.length : points.length - 1;
  const at = new Float64Array(edges + 1);
  const ix = new Float64Array(edges + 1);
  const iy = new Float64Array(edges + 1);
  for (let index = 0; index < edges; index += 1) {
    const a = points[index] as Vec2;
    const b = points[(index + 1) % points.length] as Vec2;
    const length = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    at[index + 1] = (at[index] as number) + length;
    ix[index + 1] = (ix[index] as number) + (length * (a.x + b.x)) / 2;
    iy[index + 1] = (iy[index] as number) + (length * (a.y + b.y)) / 2;
  }
  return { points, periodic, at, ix, iy, total: at[edges] as number };
}

// The integral of the outline's x and y from its start to arc length s.
function integralAt(walk: ArcWalk, s: number, edge: { index: number }): Vec2 {
  const { at, points } = walk;
  const last = at.length - 1;
  while (edge.index < last - 1 && (at[edge.index + 1] as number) < s) edge.index += 1;
  const index = edge.index;
  const a = points[index] as Vec2;
  const b = points[(index + 1) % points.length] as Vec2;
  const length = (at[index + 1] as number) - (at[index] as number);
  const along = Math.min(Math.max(s - (at[index] as number), 0), length);
  const share = length > 0 ? (along * along) / (2 * length) : 0;
  return {
    x: (walk.ix[index] as number) + along * a.x + share * (b.x - a.x),
    y: (walk.iy[index] as number) + along * a.y + share * (b.y - a.y),
  };
}

// Sample k is the outline's average over [k - 1/2, k + 1/2] spacings. An open
// run keeps its exact ends; a periodic one wraps its first box round the seam.
function boxSamples(walk: ArcWalk, count: number, spacing: number, periodic: boolean): Vec2[] {
  const edge = { index: 0 };
  const boundaries: Vec2[] = [];
  for (let k = 0; k <= count; k += 1) {
    const s = Math.min(walk.total, Math.max(0, (k - 0.5) * spacing));
    boundaries.push(integralAt(walk, s, edge));
  }
  const samples: Vec2[] = [];
  const size = periodic ? count : count + 1;
  for (let k = 0; k < size; k += 1) {
    const from = boundaries[k] as Vec2;
    const to = boundaries[Math.min(k + 1, count)] as Vec2;
    const low = Math.max(0, (k - 0.5) * spacing);
    const high = Math.min(walk.total, (k + 0.5) * spacing);
    samples.push({ x: (to.x - from.x) / (high - low), y: (to.y - from.y) / (high - low) });
  }
  if (periodic) samples[0] = wrappedFirstSample(walk, boundaries, spacing);
  return samples;
}

function wrappedFirstSample(walk: ArcWalk, boundaries: ReadonlyArray<Vec2>, spacing: number): Vec2 {
  const head = boundaries[1] as Vec2; // integral over [0, spacing / 2]
  const edge = { index: 0 };
  const tailStart = integralAt(walk, walk.total - spacing / 2, edge);
  const total = {
    x: walk.ix[walk.ix.length - 1] as number,
    y: walk.iy[walk.iy.length - 1] as number,
  };
  return {
    x: (head.x + total.x - tailStart.x) / spacing,
    y: (head.y + total.y - tailStart.y) / spacing,
  };
}

function gaussianKernel(sigmaSamples: number): Float64Array {
  const reach = Math.max(1, Math.ceil(sigmaSamples * KERNEL_REACH_SIGMAS));
  const kernel = new Float64Array(2 * reach + 1);
  let sum = 0;
  for (let k = -reach; k <= reach; k += 1) {
    const weight = Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples));
    kernel[k + reach] = weight;
    sum += weight;
  }
  for (let k = 0; k < kernel.length; k += 1) kernel[k] = (kernel[k] as number) / sum;
  return kernel;
}

// Closed contour without corners: circular convolution, 2G - G*G.
function smoothPeriodic(samples: ReadonlyArray<Vec2>, kernels: Kernels): Vec2[] {
  const n = samples.length;
  const reach = (kernels.twice.length - 1) / 2;
  const extend = (read: (point: Vec2) => number): Float64Array => {
    const padded = new Float64Array(n + 2 * reach);
    for (let k = 0; k < padded.length; k += 1) {
      padded[k] = read(samples[(((k - reach) % n) + n) % n] as Vec2);
    }
    return padded;
  };
  const xs = twiced(
    extend((point) => point.x),
    n,
    reach,
    kernels,
  );
  const ys = twiced(
    extend((point) => point.y),
    n,
    reach,
    kernels,
  );
  return samples.map((_, k) => ({ x: xs[k] as number, y: ys[k] as number }));
}

// Open run with pinned ends. The departure from the straight line between the
// ends vanishes at both ends; extending it oddly about each end (period twice
// the run) is the point reflection, and smoothing leaves the line itself alone.
function smoothPinned(
  samples: ReadonlyArray<Vec2>,
  kernels: Kernels,
  source: ReadonlyArray<Vec2>,
): Vec2[] {
  const n = samples.length - 1;
  const first = source[0] as Vec2;
  const last = source[source.length - 1] as Vec2;
  const lineX = (k: number): number => first.x + ((last.x - first.x) * k) / n;
  const lineY = (k: number): number => first.y + ((last.y - first.y) * k) / n;
  const reach = (kernels.twice.length - 1) / 2;
  const period = 2 * n;
  const extend = (departure: (k: number) => number): Float64Array => {
    const padded = new Float64Array(n + 1 + 2 * reach);
    for (let k = 0; k < padded.length; k += 1) {
      const r = (((k - reach) % period) + period) % period;
      padded[k] = r <= n ? departure(r) : -departure(period - r);
    }
    return padded;
  };
  const inside = (k: number): boolean => k > 0 && k < n;
  const dx = twiced(
    extend((k) => (inside(k) ? (samples[k] as Vec2).x - lineX(k) : 0)),
    n + 1,
    reach,
    kernels,
  );
  const dy = twiced(
    extend((k) => (inside(k) ? (samples[k] as Vec2).y - lineY(k) : 0)),
    n + 1,
    reach,
    kernels,
  );
  const out: Vec2[] = [first];
  for (let k = 1; k < n; k += 1) {
    out.push({ x: lineX(k) + (dx[k] as number), y: lineY(k) + (dy[k] as number) });
  }
  out.push(last);
  return out;
}

// 2G - G*G of `count` values stored with `reach` values of extension on each side.
function twiced(
  padded: Float64Array,
  count: number,
  reach: number,
  kernels: Kernels,
): Float64Array {
  const once = kernels.once;
  const twice = kernels.twice;
  const onceReach = (once.length - 1) / 2;
  const out = new Float64Array(count);
  for (let k = 0; k < count; k += 1) {
    const centre = k + reach;
    let smoothed = 0;
    for (let j = 0; j < once.length; j += 1) {
      smoothed += (once[j] as number) * (padded[centre - onceReach + j] as number);
    }
    let smoothedTwice = 0;
    for (let j = 0; j < twice.length; j += 1) {
      smoothedTwice += (twice[j] as number) * (padded[centre - reach + j] as number);
    }
    out[k] = 2 * smoothed - smoothedTwice;
  }
  return out;
}
