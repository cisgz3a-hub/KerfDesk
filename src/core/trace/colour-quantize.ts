// Colour quantisation for the colour-layer trace (ADR-402). Own design:
// every pixel is converted to OKLab (colour-oklab.ts), an automatic or
// requested palette is chosen by weighted k-means (colour-palette.ts), each
// pixel takes its nearest palette colour, the label map is cleaned of
// anti-aliasing seams, 1-px islands and specks (colour-label-cleanup.ts), and
// each label's final colour is the mean of its pixels. The border-dominant
// colour is reported as the paper/background.
//
// Pure core: deterministic, no clock, no random, no I/O.

import { okLabToHex, okLabToSrgb, srgbToOkLab, type OkLab } from './colour-oklab';
import {
  AUTO_MERGE_DE,
  choosePalette,
  NON_FLAT_WEIGHT,
  REQUESTED_MERGE_DE,
  type Centre,
} from './colour-palette';
import {
  absorbSmallRegions,
  giveMixturesToNeighbours,
  modeFilterIsolatedPixels,
  neighbour4,
  TRANSPARENT_LABEL,
} from './colour-label-cleanup';
import type { RawImageData } from './trace-image';

export { TRANSPARENT_LABEL } from './colour-label-cleanup';

export type PaletteColour = {
  readonly lab: OkLab;
  /** The same colour as sRGB bytes (edge coverage is read in sRGB). */
  readonly srgb: readonly [number, number, number];
  readonly hex: string;
  /** Opaque pixels carrying this label after cleanup. */
  readonly pixels: number;
};

export type QuantizedColours = {
  readonly width: number;
  readonly height: number;
  /** Palette index per pixel, or TRANSPARENT_LABEL. */
  readonly labels: Uint8Array;
  /** OKLab per pixel (3 floats). */
  readonly lab: Float32Array;
  /** The source RGBA bytes, read for sub-pixel boundary placement. */
  readonly rgba: RawImageData['data'];
  readonly palette: ReadonlyArray<PaletteColour>;
  /** Palette index of the detected paper colour, or null. */
  readonly backgroundIndex: number | null;
  readonly hasTransparency: boolean;
};

export type QuantizeOptions = {
  /** Maximum palette size including background; undefined = automatic. */
  readonly colours?: number;
  /** Regions (4-connected) below this pixel area join a neighbour. */
  readonly minRegionPx: number;
};

// A pixel is "flat" when every 4-neighbour is within this OKLab distance.
// ~0.05 is a clearly visible but small difference (JPEG noise and paper

// A pixel is "flat" when every 4-neighbour is within this OKLab distance.
// ~0.05 is a clearly visible but small difference (JPEG noise and paper
// texture stay below it; any anti-aliased edge step exceeds it).
const FLAT_DE = 0.05;
const BACKGROUND_MIN_BORDER_SHARE = 0.5;
const ALPHA_OPAQUE_MIN = 128;

export function quantizeColours(image: RawImageData, options: QuantizeOptions): QuantizedColours {
  const { width, height } = image;
  const { lab, opaque, hasTransparency } = okLabPixels(image);
  const weights = flatnessWeights(lab, opaque, width);
  const centres = choosePalette(image, opaque, weights, options.colours);
  const grid = { labels: assignLabels(lab, opaque, centres), width, height };
  if (centres.length > 2) giveMixturesToNeighbours(grid, lab, weights, centres);
  modeFilterIsolatedPixels(grid);
  absorbSmallRegions(grid, options.minRegionPx);
  const requested = options.colours !== undefined;
  const palette = finalPalette(grid.labels, lab, weights, centres.length, {
    uniform: requested,
    mergeDe: requested ? REQUESTED_MERGE_DE : AUTO_MERGE_DE,
  });
  return {
    width,
    height,
    labels: palette.labels,
    lab,
    rgba: image.data,
    palette: palette.colours,
    backgroundIndex: hasTransparency ? null : borderBackground(palette.labels, width, height),
    hasTransparency,
  };
}

function okLabPixels(image: RawImageData): {
  readonly lab: Float32Array;
  readonly opaque: Uint8Array;
  readonly hasTransparency: boolean;
} {
  const n = image.width * image.height;
  const lab = new Float32Array(n * 3);
  const opaque = new Uint8Array(n);
  let hasTransparency = false;
  const data = image.data;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    if ((data[o + 3] ?? 255) < ALPHA_OPAQUE_MIN) {
      hasTransparency = true;
      continue;
    }
    opaque[i] = 1;
    const v = srgbToOkLab(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0);
    lab[i * 3] = v[0];
    lab[i * 3 + 1] = v[1];
    lab[i * 3 + 2] = v[2];
  }
  return { lab, opaque, hasTransparency };
}

// 1 for a flat pixel (every opaque 4-neighbour within FLAT_DE), else the
// reduced weight of an edge or texture mixture; 0 for transparency.
function flatnessWeights(lab: Float32Array, opaque: Uint8Array, width: number): Float32Array {
  const n = opaque.length;
  const weights = new Float32Array(n);
  const limit = FLAT_DE * FLAT_DE;
  for (let i = 0; i < n; i += 1) {
    if (opaque[i] === 0) continue;
    let flat = true;
    for (let d = 0; d < 4 && flat; d += 1) {
      const q = neighbour4(i, d, width, n);
      if (q >= 0 && opaque[q] === 1 && distSqAt(lab, i, q) > limit) flat = false;
    }
    weights[i] = flat ? 1 : NON_FLAT_WEIGHT;
  }
  return weights;
}

function distSqAt(lab: Float32Array, i: number, j: number): number {
  const dl = (lab[i * 3] as number) - (lab[j * 3] as number);
  const da = (lab[i * 3 + 1] as number) - (lab[j * 3 + 1] as number);
  const db = (lab[i * 3 + 2] as number) - (lab[j * 3 + 2] as number);
  return dl * dl + da * da + db * db;
}

function assignLabels(
  lab: Float32Array,
  opaque: Uint8Array,
  centres: ReadonlyArray<Centre>,
): Uint8Array {
  const labels = new Uint8Array(opaque.length).fill(TRANSPARENT_LABEL);
  if (centres.length === 0) return labels;
  for (let i = 0; i < opaque.length; i += 1) {
    if (opaque[i] === 0) continue;
    const L = lab[i * 3] as number;
    const a = lab[i * 3 + 1] as number;
    const b = lab[i * 3 + 2] as number;
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let c = 0; c < centres.length; c += 1) {
      const t = centres[c] as Centre;
      const d = (L - t.L) ** 2 + (a - t.a) ** 2 + (b - t.b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    labels[i] = best;
  }
  return labels;
}

// Each label's colour is the mean of its pixels — flat pixels only count
// fully for an automatic palette (edge mixtures would drag it), every pixel
// counts for a requested one (the clusters were formed that way). Labels whose
// final colours ended up within the merge distance become one.
function finalPalette(
  labels: Uint8Array,
  lab: Float32Array,
  weights: Float32Array,
  k: number,
  merge: { readonly uniform: boolean; readonly mergeDe: number },
): { readonly labels: Uint8Array; readonly colours: PaletteColour[] } {
  const means = labelMeans(labels, lab, weights, k, merge.uniform);
  const alias = closeLabelAliases(means.centres, merge.mergeDe);
  if (alias !== null) {
    for (let i = 0; i < labels.length; i += 1) {
      const l = labels[i] as number;
      if (l !== TRANSPARENT_LABEL) labels[i] = alias[l] as number;
    }
    return finalPalette(labels, lab, weights, k, merge);
  }
  const remap = new Uint8Array(256).fill(TRANSPARENT_LABEL);
  const colours: PaletteColour[] = [];
  const usedHex = new Set<string>();
  for (let l = 0; l < k; l += 1) {
    const centre = means.centres[l];
    if (centre === undefined) continue;
    remap[l] = colours.length;
    colours.push({
      lab: centre,
      srgb: okLabToSrgb(centre),
      hex: uniqueHex(okLabToHex(centre), usedHex),
      pixels: means.pixels[l] as number,
    });
  }
  const out = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i += 1) out[i] = remap[labels[i] as number] as number;
  return { labels: out, colours };
}

// Label -> the earlier label it merges into, or null when no two label means
// lie within mergeDe.
function closeLabelAliases(
  centres: ReadonlyArray<OkLab | undefined>,
  mergeDe: number,
): Int32Array | null {
  const alias = new Int32Array(centres.length).map((_, l) => l);
  let merged = false;
  centres.forEach((ml, l) => {
    if (ml === undefined) return;
    const m = centres.findIndex(
      (mm, j) => j < l && mm !== undefined && alias[j] === j && labDistSq(ml, mm) < mergeDe ** 2,
    );
    if (m < 0) return;
    alias[l] = m;
    merged = true;
  });
  return merged ? alias : null;
}

function labDistSq(p: OkLab, q: OkLab): number {
  return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
}

function labelMeans(
  labels: Uint8Array,
  lab: Float32Array,
  weights: Float32Array,
  k: number,
  uniform: boolean,
): { readonly centres: Array<OkLab | undefined>; readonly pixels: Int32Array } {
  const sum = new Float64Array(k * 4);
  const pixels = new Int32Array(k);
  for (let i = 0; i < labels.length; i += 1) {
    const l = labels[i] as number;
    if (l === TRANSPARENT_LABEL) continue;
    const w = uniform ? 1 : (weights[i] as number);
    sum[l * 4] = (sum[l * 4] as number) + w;
    sum[l * 4 + 1] = (sum[l * 4 + 1] as number) + w * (lab[i * 3] as number);
    sum[l * 4 + 2] = (sum[l * 4 + 2] as number) + w * (lab[i * 3 + 1] as number);
    sum[l * 4 + 3] = (sum[l * 4 + 3] as number) + w * (lab[i * 3 + 2] as number);
    pixels[l] = (pixels[l] as number) + 1;
  }
  const centres: Array<OkLab | undefined> = [];
  for (let l = 0; l < k; l += 1) {
    const w = sum[l * 4] as number;
    centres.push(
      (pixels[l] as number) === 0 || w <= 0
        ? undefined
        : [
            (sum[l * 4 + 1] as number) / w,
            (sum[l * 4 + 2] as number) / w,
            (sum[l * 4 + 3] as number) / w,
          ],
    );
  }
  return { centres, pixels };
}

// Colours key operations downstream, so two palette entries must never share
// a hex even when they round to the same bytes.
function uniqueHex(hex: string, used: Set<string>): string {
  let value = Number.parseInt(hex.slice(1), 16);
  let candidate = hex;
  while (used.has(candidate)) {
    value = (value + 1) & 0xffffff;
    candidate = `#${value.toString(16).padStart(6, '0')}`;
  }
  used.add(candidate);
  return candidate;
}

/** The paper colour: the label holding at least half of the opaque border
 *  pixels. Art that fills the frame has no background. */
function borderBackground(labels: Uint8Array, width: number, height: number): number | null {
  const counts = new Int32Array(256);
  let total = 0;
  const visit = (i: number): void => {
    const l = labels[i] as number;
    if (l === TRANSPARENT_LABEL) return;
    counts[l] = (counts[l] as number) + 1;
    total += 1;
  };
  for (let x = 0; x < width; x += 1) {
    visit(x);
    if (height > 1) visit((height - 1) * width + x);
  }
  for (let y = 1; y + 1 < height; y += 1) {
    visit(y * width);
    if (width > 1) visit(y * width + width - 1);
  }
  let best = -1;
  let bestCount = 0;
  for (let l = 0; l < 255; l += 1) {
    if ((counts[l] as number) > bestCount) {
      bestCount = counts[l] as number;
      best = l;
    }
  }
  return best >= 0 && bestCount >= BACKGROUND_MIN_BORDER_SHARE * total ? best : null;
}
