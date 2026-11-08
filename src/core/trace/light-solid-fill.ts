// Light-solid recovery for the automatic detail mask (ADR-401).
//
// A local-contrast test (ink = luma < localMean − bias) sees a large flat
// region only where its neighbourhood window reaches brighter paper, so a
// light solid (gold, tan, light blue: luma above the brightness band) comes
// out as a band about one window radius wide around a background interior.
// Adaptive thresholds share this failure mode; the published remedies
// (Sauvola 2000, Wolf–Jolion 2004) damp the local test in low-variance
// areas. Here the local test is kept exactly as it is — it is what recovers
// faint strokes — and solids are found independently of it, on a lightly
// smoothed luma plane, so that pixel noise does not decide the outcome:
//
//   * a SOLID is a 4-connected run of flat pixels (the smoothed luma barely
//     changes between neighbours) whose tone lies between the brightness band
//     and the paper tone, and which is flat as a whole;
//   * paper is the brightest tone that covers a real share of the flat
//     pixels, so a solid larger than the margin around it, a thin frame line
//     or art reaching the image edge does not become "paper";
//   * a solid must differ from paper in hue, not only in brightness: a cast
//     shadow or a vignette is paper's own chromaticity at a lower luma, and a
//     grey patch cannot be told from one;
//   * a solid must not touch the image border (a cropped background or a
//     photographed ground is not an object on the sheet);
//   * a solid must not carry darker artwork inside it: a stroke, dot or text
//     that it encloses without that mark reaching paper. Such an area is the
//     surface something is drawn on (a sketchbook page, a label plate), and
//     filling it would erase the drawing. Lines that run out to paper (a
//     black outline, a cross, a divider) only outline or split a solid. Any
//     other solid with the tone and hue of a drawn-on surface is that surface
//     too (the inside of a circle drawn on a page).
//
// Accepted solids are ink on all their flat pixels. On the transition pixels
// around them — non-flat pixels reached through other non-flat pixels only,
// and nearer to this solid than to any other flat mid-tone area — the iso is
// the midpoint between the solid's tone and paper, in both the mask and the
// crack field, so outlines land at half coverage while a neighbouring flat
// colour keeps its own side of the edge.

import {
  boxMoments,
  chromaDistance,
  chromaticity,
  countBelow,
  neighbours8,
} from './light-solid-pixels';
import {
  CANDIDATE,
  labelRegions,
  rejectCutOuts,
  REJECTED,
  SMOOTH_RADIUS_PX,
  solidIso,
  SURFACE,
  type Context,
  type Regions,
} from './light-solid-regions';

/** Solids must be at least this far (luma) below paper; lighter areas are
 *  paper tints. */
const MIN_PAPER_DISTANCE = 12;
/** Largest smoothed-luma step between 4-neighbours inside a flat area. A step
 *  edge of contrast c moves the 5×5 mean by c/5 per pixel, so tones more than
 *  about 20 apart are separate areas, while luma noise of sd 8 moves it by
 *  about 1 per pixel. */
const FLAT_STEP = 4;
/** Maximum luma standard deviation inside one smoothing window of a flat
 *  pixel: well above sensor noise (sd 8 is common in phone photos), below
 *  the spread a window takes across a thin line (about half its contrast). */
const MAX_LOCAL_DEVIATION = 20;
/** Maximum smoothed-luma standard deviation of a solid: a near-uniform tone
 *  (pixel noise of sd 8 leaves about 2 after smoothing). Gradient fills (sky,
 *  glass reflections) would only fill in patches and are left to the local
 *  test. */
const MAX_FLAT_DEVIATION = 6;
/** Minimum chromaticity distance from paper (largest per-channel difference
 *  of channel ÷ mean channel). Shadows and greys sit near 0; for scale, on
 *  white: tan 0.21, pink 0.18, light blue 0.16, gold 0.93. */
const MIN_CHROMA_DISTANCE = 0.05;
/** Share of the flat pixels a tone needs to count as paper. */
const PAPER_SHARE = 0.05;
/** Smoothed luma this far below a solid marks enclosed content as darker
 *  artwork (a 1 px stroke 30 darker than its page lowers the 5×5 mean by 6). */
const FOREIGN_DEPTH = 6;
/** Darker pixels an enclosed mark needs (source px²). */
const MIN_FOREIGN_PX = 16;
/** Tone and hue closeness that makes a solid part of a drawn-on surface. */
const SURFACE_TONE_TOLERANCE = 10;
const SURFACE_CHROMA_TOLERANCE = 0.03;
/** Smallest solid considered (source px²); smaller areas the local test fills. */
const MIN_SOLID_PX = 16;
export type SolidPlane = {
  readonly width: number;
  readonly height: number;
  /** Luma per pixel (transparent pixels read as paper, 255). */
  readonly luma: Float32Array;
  /** The RGBA pixels the luma was read from. */
  readonly rgba: Uint8ClampedArray;
  /** Working px per source px (the detector window scale: supersampling times a
   *  finer commit grid's ratio, ADR-409 Amendment 2); the pixel constants above
   *  are in source px. */
  readonly pixelScale: number;
};

type Paper = { readonly luma: number; readonly chroma: readonly number[] };

/**
 * Per-pixel iso over light solids that the local-contrast mask hollows, or
 * null when there are none. A pixel is ink when its luma is at or below the
 * returned value (entries are −Infinity away from solids).
 */
export function lightSolidIso(plane: SolidPlane, bandUpper: number): Float32Array | null {
  const { width, height, luma } = plane;
  const scale = Math.max(1, plane.pixelScale);
  const radius = Math.max(1, Math.round(SMOOTH_RADIUS_PX * scale));
  // Only the mean survives flatMask; the mean of squares is released.
  const { smooth, flat } = flatMask(
    plane,
    boxMoments(luma, width, height, radius),
    FLAT_STEP / scale,
  );
  const histogram = flatHistogram(plane, smooth, flat);
  const paper = estimatePaper(histogram);
  if (paper === null) return null;
  const upper = paper.luma - MIN_PAPER_DISTANCE;
  if (!hasMidTone(histogram, bandUpper, upper)) return null;
  const ctx: Context = {
    plane,
    smooth,
    flat,
    labels: new Int32Array(luma.length).fill(-1),
    queue: new Int32Array(luma.length),
    scale,
  };
  const regions = labelRegions(ctx, { lower: bandUpper, upper });
  classifyRegions(regions, paper, scale);
  if (!regions.status.includes(CANDIDATE)) return null;
  rejectCutOuts(ctx, regions, upper);
  // Surfaces are only ever marked among candidates.
  if (!regions.status.includes(CANDIDATE)) return null;
  markDrawnSurfaces(ctx, regions, upper);
  spreadSurfaces(regions);
  if (!regions.status.includes(CANDIDATE)) return null;
  return solidIso(ctx, regions, paper.luma);
}

/** 1 where the smoothed luma steps by at most `step` to every 4-neighbour
 *  and the window's own luma deviation is at most MAX_LOCAL_DEVIATION. The
 *  deviation test keeps the core of a thin line, where a window wider than
 *  the line averages to a flat value, out of the flat areas. */
function flatMask(
  plane: SolidPlane,
  moments: { readonly mean: Float32Array; readonly meanSquare: Float32Array },
  step: number,
): { readonly smooth: Float32Array; readonly flat: Uint8Array } {
  const { width, height } = plane;
  const { mean: smooth, meanSquare } = moments;
  const flat = new Uint8Array(smooth.length);
  const maxVariance = MAX_LOCAL_DEVIATION ** 2;
  for (let i = 0; i < flat.length; i += 1) {
    const v = smooth[i] as number;
    flat[i] = (meanSquare[i] as number) - v * v <= maxVariance ? 1 : 0;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const v = smooth[i] as number;
      if (x + 1 < width && Math.abs(v - (smooth[i + 1] as number)) > step) {
        flat[i] = 0;
        flat[i + 1] = 0;
      }
      if (y + 1 < height && Math.abs(v - (smooth[i + width] as number)) > step) {
        flat[i] = 0;
        flat[i + width] = 0;
      }
    }
  }
  return { smooth, flat };
}

/** Flat pixels per rounded smoothed-luma level, with each level's sums of
 *  smoothed luma, r, g and b (four entries per level). */
type ToneHistogram = { readonly counts: Float64Array; readonly sums: Float64Array; total: number };

function flatHistogram(plane: SolidPlane, smooth: Float32Array, flat: Uint8Array): ToneHistogram {
  const histogram: ToneHistogram = {
    counts: new Float64Array(256),
    sums: new Float64Array(256 * 4),
    total: 0,
  };
  const { counts, sums } = histogram;
  const { rgba } = plane;
  for (let i = 0; i < smooth.length; i += 1) {
    if (flat[i] !== 1) continue;
    const v = smooth[i] as number;
    const level = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
    const o = 4 * i;
    const clear = rgba[o + 3] === 0;
    const at = 4 * level;
    counts[level] = (counts[level] as number) + 1;
    sums[at] = (sums[at] as number) + v;
    sums[at + 1] = (sums[at + 1] as number) + (clear ? 255 : (rgba[o] as number));
    sums[at + 2] = (sums[at + 2] as number) + (clear ? 255 : (rgba[o + 1] as number));
    sums[at + 3] = (sums[at + 3] as number) + (clear ? 255 : (rgba[o + 2] as number));
    histogram.total += 1;
  }
  return histogram;
}

/** Paper: the brightest smoothed-luma level (5-level window) holding at least
 *  PAPER_SHARE of the flat pixels, moved to the local mode just below it, with
 *  the mean luma and chromaticity of the flat pixels in that window. */
function estimatePaper(histogram: ToneHistogram): Paper | null {
  const { counts, sums, total } = histogram;
  if (total === 0) return null;
  const windowed = (level: number): number => {
    let count = 0;
    for (let d = -2; d <= 2; d += 1) count += counts[level + d] ?? 0;
    return count;
  };
  let level = 255;
  while (level > 0 && windowed(level) < PAPER_SHARE * total) level -= 1;
  let mode = level;
  for (let l = level - 1; l >= Math.max(0, level - 4); l -= 1) {
    if (windowed(l) > windowed(mode)) mode = l;
  }
  const totals = [0, 0, 0, 0];
  for (let l = Math.max(0, mode - 2); l <= Math.min(255, mode + 2); l += 1) {
    for (let k = 0; k < 4; k += 1) totals[k] = (totals[k] as number) + (sums[4 * l + k] as number);
  }
  const count = windowed(mode);
  if (count === 0) return null;
  return {
    luma: (totals[0] as number) / count,
    chroma: chromaticity(totals[1] as number, totals[2] as number, totals[3] as number),
  };
}

/** Whether any flat pixel's smoothed luma may lie in (lower, upper]. */
function hasMidTone(histogram: ToneHistogram, lower: number, upper: number): boolean {
  const from = Math.max(0, Math.floor(lower));
  const to = Math.min(255, Math.ceil(upper));
  for (let level = from; level <= to; level += 1) {
    if ((histogram.counts[level] as number) > 0) return true;
  }
  return false;
}

/** Candidates: big enough, off the image border, flat as a whole, and
 *  chromatically distinct from paper. */
function classifyRegions(regions: Regions, paper: Paper, scale: number): void {
  const minCount = MIN_SOLID_PX * scale * scale;
  for (let id = 0; id < regions.count.length; id += 1) {
    const count = regions.count[id] as number;
    const tone = regions.tone[id] as number;
    const deviation = Math.sqrt(Math.max(0, (regions.sumSq[id] as number) / count - tone * tone));
    const candidate =
      count >= minCount &&
      regions.border[id] !== true &&
      deviation <= MAX_FLAT_DEVIATION &&
      chromaDistance(regionChroma(regions, id), paper.chroma) >= MIN_CHROMA_DISTANCE;
    regions.status[id] = candidate ? CANDIDATE : REJECTED;
  }
}

type EnclosureSearch = {
  readonly ctx: Context;
  readonly regions: Regions;
  readonly visited: Uint8Array;
  readonly paperLike: number;
  /** Candidate (or surface) id at a pixel, else −1. */
  readonly candidateAt: (i: number) => number;
};

/** Mark candidates that enclose darker artwork as drawn-on surfaces. An
 *  8-connected component of non-candidate pixels that neither reaches the
 *  image border nor holds a paper-toned pixel is enclosed by candidates; when
 *  it holds enough pixels darker than the darkest candidate around it, every
 *  candidate around it is a surface. Only components next to a candidate can
 *  be enclosed, so the search starts there and stops at the first sign of an
 *  opening; each pixel is visited at most once. */
function markDrawnSurfaces(ctx: Context, regions: Regions, paperLike: number): void {
  const { plane, smooth, labels, scale } = ctx;
  const search: EnclosureSearch = {
    ctx,
    regions,
    visited: new Uint8Array(smooth.length),
    paperLike,
    candidateAt: (i) => {
      const id = labels[i] as number;
      return id >= 0 && regions.status[id] !== REJECTED ? id : -1;
    },
  };
  const seeds = new Int32Array(8);
  const minForeign = MIN_FOREIGN_PX * scale * scale;
  for (let p = 0; p < smooth.length; p += 1) {
    if (search.candidateAt(p) < 0) continue;
    neighbours8(seeds, p, plane.width, plane.height);
    for (const start of seeds) {
      if (start < 0 || search.visited[start] !== 0 || search.candidateAt(start) >= 0) continue;
      const enclosed = floodEnclosed(search, start);
      if (enclosed === null) continue;
      const level = (regions.tone[enclosed.darkestSolid] as number) - FOREIGN_DEPTH;
      if (countBelow(smooth, ctx.queue, enclosed.size, level) < minForeign) continue;
      markAround(search, enclosed.size);
    }
  }
}

/** Visit marks of the enclosure search: part of the current (or an earlier,
 *  enclosed) flood, or part of a component already known to be open. */
const IN_FLOOD = 1;
const OPEN = 2;

/** Flood the non-candidate component holding `start` into the queue. Returns
 *  null as soon as it reaches the image border, a paper-toned pixel or a
 *  component already found open (marking what it flooded as open too). */
function floodEnclosed(
  search: EnclosureSearch,
  start: number,
): { readonly size: number; readonly darkestSolid: number } | null {
  const { ctx, regions, visited, candidateAt } = search;
  const { plane, smooth, queue } = ctx;
  const around = new Int32Array(8);
  visited[start] = IN_FLOOD;
  queue[0] = start;
  let tail = 1;
  let darkestSolid = -1;
  const opened = (): null => {
    for (let k = 0; k < tail; k += 1) visited[queue[k] as number] = OPEN;
    return null;
  };
  for (let head = 0; head < tail; head += 1) {
    const i = queue[head] as number;
    if (neighbours8(around, i, plane.width, plane.height)) return opened();
    if ((smooth[i] as number) > search.paperLike) return opened();
    for (const n of around) {
      if (visited[n] === OPEN) return opened();
      if (visited[n] === IN_FLOOD) continue;
      const solid = candidateAt(n);
      if (solid < 0) {
        visited[n] = IN_FLOOD;
        queue[tail] = n;
        tail += 1;
      } else if (
        darkestSolid < 0 ||
        (regions.tone[solid] as number) < (regions.tone[darkestSolid] as number)
      ) {
        darkestSolid = solid;
      }
    }
  }
  return darkestSolid < 0 ? null : { size: tail, darkestSolid };
}

/** Mark every candidate touching the first `size` queued pixels a surface. */
function markAround(search: EnclosureSearch, size: number): void {
  const { ctx, regions, candidateAt } = search;
  const around = new Int32Array(8);
  for (let k = 0; k < size; k += 1) {
    neighbours8(around, ctx.queue[k] as number, ctx.plane.width, ctx.plane.height);
    for (const n of around) {
      const solid = n < 0 ? -1 : candidateAt(n);
      if (solid >= 0) regions.status[solid] = SURFACE;
    }
  }
}

/** A candidate with the tone and hue of a drawn-on surface is that surface. */
function spreadSurfaces(regions: Regions): void {
  const surfaces: number[] = [];
  regions.status.forEach((status, id) => {
    if (status === SURFACE) surfaces.push(id);
  });
  if (surfaces.length === 0) return;
  const surfaceChroma = surfaces.map((id) => regionChroma(regions, id));
  regions.status.forEach((status, id) => {
    if (status !== CANDIDATE) return;
    const tone = regions.tone[id] as number;
    const chroma = regionChroma(regions, id);
    const same = surfaces.some(
      (s, k) =>
        Math.abs((regions.tone[s] as number) - tone) <= SURFACE_TONE_TOLERANCE &&
        chromaDistance(chroma, surfaceChroma[k] as number[]) <= SURFACE_CHROMA_TOLERANCE,
    );
    if (same) regions.status[id] = SURFACE;
  });
}

function regionChroma(regions: Regions, id: number): number[] {
  return chromaticity(
    regions.rgb[3 * id] as number,
    regions.rgb[3 * id + 1] as number,
    regions.rgb[3 * id + 2] as number,
  );
}
