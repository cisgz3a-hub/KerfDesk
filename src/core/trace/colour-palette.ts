// Palette selection for the colour-layer trace (ADR-430). Own design, built
// from standard published pieces:
//   - OKLab (B. Ottosson, "A perceptual color space for image processing",
//     2020) so distances approximate visible colour difference;
//   - weighted Lloyd k-means (S. Lloyd, "Least squares quantization in PCM",
//     IEEE Trans. Inf. Theory 28(2), 1982) over a 15-bit colour histogram,
//     seeded deterministically by greedy weighted farthest-point selection;
//   - flat-pixel weighting: anti-aliased and textured pixels are MIXTURES of
//     the colours around them, not colours of their own, so pixels whose
//     4-neighbours differ visibly count a tenth as much when choosing an
//     automatic palette (the observation Kopf & Lischinski 2011 make for
//     pixel art).
//
// Pure core: deterministic, no clock, no random, no I/O.

import { okLabToSrgb, srgbToOkLab } from './colour-oklab';
import type { RawImageData } from './trace-image';

/** Clustering weight of a pixel whose 4-neighbours differ visibly. */
export const NON_FLAT_WEIGHT = 0.1;
// Automatic count: cluster at most this many, then merge colours closer than
// AUTO_MERGE_DE and dissolve clusters below AUTO_MIN_SHARE of the flat area.
const AUTO_MAX_COLOURS = 8;
export const AUTO_MERGE_DE = 0.08;
const AUTO_MIN_SHARE = 0.002;
// An automatic colour lying between two others needs this much flat area.
const AUTO_BETWEEN_MAX_SHARE = 0.03;
// A requested count only merges true duplicates.
export const REQUESTED_MERGE_DE = 0.05;
const LLOYD_MAX_ITERATIONS = 40;
// A colour counts as a mixture of colours a and b when, in sRGB, it lies
// within this fraction of |ab| from the segment ab (see isMixtureOf).
const BETWEEN_RESIDUAL_FRACTION = 0.3;
const HISTOGRAM_BINS = 32768;

type Histogram = {
  readonly count: number;
  /** Clustering weight per bin. */
  readonly w: Float64Array;
  /** Flat-pixel count per bin (evidence of a real colour area). */
  readonly flat: Float64Array;
  readonly L: Float64Array;
  readonly a: Float64Array;
  readonly b: Float64Array;
};

function colourHistogram(
  image: RawImageData,
  opaque: Uint8Array,
  weights: Float32Array,
  uniform: boolean,
): Histogram {
  const bins = {
    w: new Float64Array(HISTOGRAM_BINS),
    flat: new Float64Array(HISTOGRAM_BINS),
    L: new Float64Array(HISTOGRAM_BINS),
    a: new Float64Array(HISTOGRAM_BINS),
    b: new Float64Array(HISTOGRAM_BINS),
  };
  const data = image.data;
  for (let i = 0; i < opaque.length; i += 1) {
    if (opaque[i] === 0) continue;
    const flat = (weights[i] as number) >= 1;
    addToBin(bins, data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0, {
      weight: uniform || flat ? 1 : NON_FLAT_WEIGHT,
      flat,
    });
  }
  return compactHistogram(bins);
}

type HistogramBins = {
  readonly w: Float64Array;
  readonly flat: Float64Array;
  readonly L: Float64Array;
  readonly a: Float64Array;
  readonly b: Float64Array;
};

// 15-bit sRGB bin; each bin keeps weighted OKLab sums of its exact pixels.
function addToBin(
  bins: HistogramBins,
  r: number,
  g: number,
  b: number,
  pixel: { readonly weight: number; readonly flat: boolean },
): void {
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  const w = pixel.weight;
  const v = srgbToOkLab(r, g, b);
  bins.w[key] = (bins.w[key] as number) + w;
  if (pixel.flat) bins.flat[key] = (bins.flat[key] as number) + 1;
  bins.L[key] = (bins.L[key] as number) + w * v[0];
  bins.a[key] = (bins.a[key] as number) + w * v[1];
  bins.b[key] = (bins.b[key] as number) + w * v[2];
}

function compactHistogram(bins: HistogramBins): Histogram {
  let count = 0;
  for (let k = 0; k < HISTOGRAM_BINS; k += 1) if ((bins.w[k] as number) > 0) count += 1;
  const w = new Float64Array(count);
  const flat = new Float64Array(count);
  const L = new Float64Array(count);
  const a = new Float64Array(count);
  const b = new Float64Array(count);
  let j = 0;
  for (let k = 0; k < HISTOGRAM_BINS; k += 1) {
    const bw = bins.w[k] as number;
    if (bw <= 0) continue;
    w[j] = bw;
    flat[j] = bins.flat[k] as number;
    L[j] = (bins.L[k] as number) / bw;
    a[j] = (bins.a[k] as number) / bw;
    b[j] = (bins.b[k] as number) / bw;
    j += 1;
  }
  return { count, w, flat, L, a, b };
}

export type Centre = { L: number; a: number; b: number; w: number };

// Automatic palette: cluster flat-weighted colours, then keep only colours
// with real flat AREA — a cluster with almost no flat pixels, or one lying
// between two other colours with little flat area, is anti-aliasing or
// texture — and merge colours closer than a clearly visible difference.
// A requested count clusters every pixel equally (the operator asked for
// that many tones) and merges only true duplicates.
export function choosePalette(
  image: RawImageData,
  opaque: Uint8Array,
  weights: Float32Array,
  requested: number | undefined,
): Centre[] {
  const hist = colourHistogram(image, opaque, weights, requested !== undefined);
  if (hist.count === 0) return [];
  let centres = lloyd(hist, seedCentres(hist, requested ?? AUTO_MAX_COLOURS));
  if (requested === undefined) centres = keepFlatAreaColours(hist, centres);
  const mergeDe = requested === undefined ? AUTO_MERGE_DE : REQUESTED_MERGE_DE;
  for (let round = 0; round < 4; round += 1) {
    const merged = mergeCloseCentres(centres, mergeDe);
    // Refine the surviving centres without adding any.
    centres = lloyd(hist, merged);
    if (
      centres.length === merged.length &&
      mergeCloseCentres(centres, mergeDe).length === centres.length
    ) {
      break;
    }
  }
  return centres;
}

function keepFlatAreaColours(hist: Histogram, centres: ReadonlyArray<Centre>): Centre[] {
  const flat = new Float64Array(centres.length);
  let total = 0;
  for (let i = 0; i < hist.count; i += 1) {
    const f = hist.flat[i] as number;
    if (f <= 0) continue;
    const c = nearestCentre(hist, i, centres);
    flat[c] = (flat[c] as number) + f;
    total += f;
  }
  if (total <= 0) return [...centres];
  const share = (c: number): number => (flat[c] as number) / total;
  const kept = centres.map((_, c) => c).filter((c) => share(c) >= AUTO_MIN_SHARE);
  // Dissolve in-between colours from the least flat area up, judged against
  // the colours still kept.
  const byArea = [...kept].sort((p, q) => share(p) - share(q));
  const alive = new Set(kept);
  for (const c of byArea) {
    if (share(c) >= AUTO_BETWEEN_MAX_SHARE || alive.size <= 2) continue;
    const others = [...alive].filter((o) => o !== c && share(o) > share(c));
    if (
      liesBetween(
        centres[c] as Centre,
        others.map((o) => centres[o] as Centre),
      )
    )
      alive.delete(c);
  }
  const result = centres.filter((_, c) => alive.has(c));
  return result.length > 0 ? result : [...centres];
}

function liesBetween(c: Centre, others: ReadonlyArray<Centre>): boolean {
  for (let i = 0; i < others.length; i += 1) {
    for (let j = i + 1; j < others.length; j += 1) {
      if (isMixtureOf(c, others[i] as Centre, others[j] as Centre)) return true;
    }
  }
  return false;
}

/** True when colour m looks like an edge mixture of a and b. Anti-aliasing
 *  blends in sRGB (most rasterisers) or in linear light; both paths stay
 *  close to the sRGB segment ab (a linear-light midpoint lies ~0.24 |ab|
 *  off it), while a distinct third colour lies well away from it. */
export function isMixtureOf(m: Centre, a: Centre, b: Centre): boolean {
  const projection = projectOnto(srgbCentre(m), srgbCentre(a), srgbCentre(b));
  return (
    projection.t > 0.05 &&
    projection.t < 0.95 &&
    projection.residual <= BETWEEN_RESIDUAL_FRACTION * projection.length
  );
}

function srgbCentre(c: Centre): Centre {
  const [r, g, b] = okLabToSrgb([c.L, c.a, c.b]);
  return { L: r, a: g, b, w: c.w };
}

function seedCentres(hist: Histogram, k: number): Centre[] {
  const centres: Centre[] = [];
  let heaviest = 0;
  for (let i = 1; i < hist.count; i += 1) {
    if ((hist.w[i] as number) > (hist.w[heaviest] as number)) heaviest = i;
  }
  centres.push(binCentre(hist, heaviest));
  const minD = new Float64Array(hist.count).fill(Number.POSITIVE_INFINITY);
  while (centres.length < k) {
    const last = centres[centres.length - 1] as Centre;
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < hist.count; i += 1) {
      const d = centreDistSq(hist, i, last);
      if (d < (minD[i] as number)) minD[i] = d;
      const score = (hist.w[i] as number) * (minD[i] as number);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0 || bestScore <= 1e-12) break;
    centres.push(binCentre(hist, best));
  }
  return centres;
}

function binCentre(hist: Histogram, i: number): Centre {
  return { L: hist.L[i] as number, a: hist.a[i] as number, b: hist.b[i] as number, w: 0 };
}

function centreDistSq(hist: Histogram, i: number, c: Centre): number {
  const dl = (hist.L[i] as number) - c.L;
  const da = (hist.a[i] as number) - c.a;
  const db = (hist.b[i] as number) - c.b;
  return dl * dl + da * da + db * db;
}

function nearestCentre(hist: Histogram, i: number, centres: ReadonlyArray<Centre>): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let c = 0; c < centres.length; c += 1) {
    const d = centreDistSq(hist, i, centres[c] as Centre);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function lloyd(hist: Histogram, seeds: ReadonlyArray<Centre>): Centre[] {
  let centres = seeds.map((c) => ({ ...c }));
  const assignment = new Int32Array(hist.count).fill(-1);
  for (let iter = 0; iter < LLOYD_MAX_ITERATIONS; iter += 1) {
    let changed = false;
    for (let i = 0; i < hist.count; i += 1) {
      const c = nearestCentre(hist, i, centres);
      if (assignment[i] !== c) {
        assignment[i] = c;
        changed = true;
      }
    }
    const next = centres.map(() => ({ L: 0, a: 0, b: 0, w: 0 }));
    for (let i = 0; i < hist.count; i += 1) {
      const t = next[assignment[i] as number] as Centre;
      const w = hist.w[i] as number;
      t.w += w;
      t.L += w * (hist.L[i] as number);
      t.a += w * (hist.a[i] as number);
      t.b += w * (hist.b[i] as number);
    }
    centres = next
      .filter((t) => t.w > 0)
      .map((t) => ({ L: t.L / t.w, a: t.a / t.w, b: t.b / t.w, w: t.w }));
    if (!changed) break;
  }
  return centres;
}

function mergeCloseCentres(input: ReadonlyArray<Centre>, threshold: number): Centre[] {
  const centres = input.map((c) => ({ ...c }));
  for (;;) {
    let bi = -1;
    let bj = -1;
    let best = threshold * threshold;
    for (let i = 0; i < centres.length; i += 1) {
      for (let j = i + 1; j < centres.length; j += 1) {
        const d = centreCentreDistSq(centres[i] as Centre, centres[j] as Centre);
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) return centres;
    const p = centres[bi] as Centre;
    const q = centres[bj] as Centre;
    const w = p.w + q.w;
    centres[bi] = {
      L: (p.L * p.w + q.L * q.w) / w,
      a: (p.a * p.w + q.a * q.w) / w,
      b: (p.b * p.w + q.b * q.w) / w,
      w,
    };
    centres.splice(bj, 1);
  }
}

function centreCentreDistSq(p: Centre, q: Centre): number {
  return (p.L - q.L) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2;
}

export function projectOnto(
  c: Centre,
  a: Centre,
  b: Centre,
): { readonly t: number; readonly residual: number; readonly length: number } {
  const dL = b.L - a.L;
  const da = b.a - a.a;
  const db = b.b - a.b;
  const len2 = dL * dL + da * da + db * db;
  if (len2 <= 1e-12) return { t: 0, residual: Number.POSITIVE_INFINITY, length: 0 };
  const t = ((c.L - a.L) * dL + (c.a - a.a) * da + (c.b - a.b) * db) / len2;
  const rL = c.L - a.L - t * dL;
  const ra = c.a - a.a - t * da;
  const rb = c.b - a.b - t * db;
  return { t, residual: Math.sqrt(rL * rL + ra * ra + rb * rb), length: Math.sqrt(len2) };
}
