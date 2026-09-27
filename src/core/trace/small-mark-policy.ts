// Small-mark policy — decides which tiny ink marks and tiny paper holes in a
// binarised trace mask are genuine art and which are noise (ADR-434).
//
// A fixed area cut cannot tell them apart: stipple dots, dotted rows, 6 px
// text and paper holes in dense hatching are the same size as scanner dust
// and threshold cracks. The historical Line Art cleanup (erase ink under
// 12 px², fill every thin enclosed hole) therefore erased almost all of an
// ink drawing's fine texture. 'auto' judges each small mark on evidence that
// separates the two classes on measured art (numbers: ADR-434):
//
//   1. Size floor. Marks under AUTO_MIN_MARK_AREA_PX source px² are dropped
//      (holes filled): a 1-2 px² mark is not a shape a laser can render.
//   2. Tone, from the pre-threshold luma, against the image's own ink and
//      paper tones (medians of mask ink and mask paper; span = paper − ink).
//      A genuine mark is drawn in the drawing's ink; noise is faint. A mark
//      must (a) REACH at least halfway from paper to the ink tone at its
//      darkest pixel (a hole: halfway from ink to paper at its brightest),
//      (b) clear the cut there by a small MARGIN (a mark a few grey levels
//      of threshold would erase is a threshold artefact), and (c) CONTRAST
//      with its one-source-pixel ring (the ring's brightest pixel for ink,
//      darkest for a hole) by a fraction of the span. (a) removes faint scan
//      specks that local-contrast detection flags as ink; (b) and (c) remove
//      noise where a mid-tone area straddles the cut, and the Arch House
//      binarisation cracks.
//   3. Neighbourhood (small-mark-neighbourhood.ts). A dark mark's tone
//      cannot tell a stipple dot from a toner speck, so what surrounds it
//      decides: a mark joined to other ink by grey (a fragment of
//      anti-aliased hatching or stipple the cut broke off) stays; otherwise
//      a mark near unbridged dark debris (sub-floor or lone specks: the
//      signature of a dirty scan) goes; otherwise a mark under
//      AUTO_ISOLATED_MARK_MIN_AREA_PX stays only if its nearest neighbour
//      within AUTO_SUPPORT_RADIUS_PX is another small (like) mark rather
//      than a stroke (stipple, dotted rows and small text versus toner
//      scatter in a stroke's halo). A paper hole is enclosed by ink by
//      construction, so these tests are ink-only.
//
// Without a grey field (alpha masks) nothing is bridged and every speck
// counts as dark; 1 and 3 apply.
//
// Everything is denominated in SOURCE pixels: areaScale is mask px² per
// source px² (pixelScale² on a supersampled trace, the working/source area
// ratio on a downscaled one), so the grid a mask happens to be traced on does
// not change what counts as a mark.
//
// Cost: one pass for the tone histograms, then work bounded by a constant
// window per candidate mark (candidates are small by definition), so the
// whole policy is linear in pixels.
//
// Our own design from textbook connected-component analysis; no third-party
// tracer code (ADR-017).

import type { CrackSubPixelField } from './contour-boundary';
import {
  AUTO_BRIDGE_FRACTION,
  AUTO_DEBRIS_TILE_PX,
  AUTO_LIKE_MARK_MAX_AREA_PX,
  createInkNeighbourhood,
  type InkNeighbourhood,
} from './small-mark-neighbourhood';
import type { TraceOptions } from './trace-option-types';
import type { RawImageData } from './trace-image';

/** Marks at or above this many source px² are always kept (the historical
 *  Line Art speck cap; auto only ever keeps MORE than it). */
export const AUTO_CANDIDATE_AREA_PX = 12;
/** Marks under this many source px² are always removed / filled. */
export const AUTO_MIN_MARK_AREA_PX = 3;
/** An isolated mark (no other ink within the support radius) is kept only
 *  from this area: a lone 3×3 dot survives, a lone 2×2 speck does not. */
export const AUTO_ISOLATED_MARK_MIN_AREA_PX = 8;
/** A like mark this close (source px, edge to edge) makes a mark part of a
 *  texture rather than a lone speck; also the bridge search window. */
export const AUTO_SUPPORT_RADIUS_PX = 5;
/** Tone evidence, each a fraction of the image's ink-to-paper span. */
export const AUTO_MIN_REACH_FRACTION = 0.5;
export const AUTO_MIN_CUT_MARGIN_FRACTION = 0.04;
export const AUTO_MIN_CONTRAST_FRACTION = 0.3;
/** Unbridged dark debris in a mark's 3x3 debris tiles that marks the area
 *  as dusty. */
export const AUTO_DUST_MIN_DEBRIS = 1;

// A span narrower than this is treated as this wide: below it the image has
// no reliable ink/paper separation to normalise against.
const MIN_TONE_SPAN_LUMA = 64;

/** What the mask cleanup does with small marks for these options (ADR-434).
 *  ink: erase ink regions under minPixels (mask px) unless keep says so;
 *  holes: fill thin enclosed paper components where fill says so (absent:
 *  every candidate). null = the stage does not run. A stage whose explicit
 *  option is set (despeckleMinPixels / fillPinholeCracks) keeps its fixed
 *  meaning exactly; the automatic policy only takes over unset stages. */
export type SmallMarkCleanupPlan = {
  readonly ink: {
    readonly minPixels: number;
    readonly keep?: (region: ReadonlyArray<number>, ink: Uint8Array) => boolean;
  } | null;
  readonly holes: { readonly fill?: (component: ReadonlyArray<number>) => boolean } | null;
};

/** binaryMask: the mask came from a binarising stage (despeckling a grey
 *  image would split its mid-tones, so neither ink stage runs otherwise). */
export function smallMarkCleanupPlan(
  image: RawImageData,
  options: TraceOptions,
  field: CrackSubPixelField | null,
  binaryMask: boolean,
): SmallMarkCleanupPlan {
  const auto = options.smallMarkPolicy === 'auto';
  const autoInk = auto && binaryMask && options.despeckleMinPixels === undefined;
  const autoHoles = auto && options.fillPinholeCracks === undefined;
  const fixed = fixedCleanupPlan(options, binaryMask);
  if (!autoInk && !autoHoles) return fixed;
  const classifier = createSmallMarkClassifier({
    width: image.width,
    height: image.height,
    ink: binaryInk(image),
    field,
    areaScale: supersampleArea(options) * workingArea(options),
  });
  return {
    ink: autoInk
      ? { minPixels: classifier.inkCandidateAreaPx, keep: classifier.keepInkMark }
      : fixed.ink,
    holes: autoHoles ? { fill: classifier.fillPaperHole } : fixed.holes,
  };
}

// The historical fixed stages: erase ink under despeckleMinPixels (a value
// of 1 or less keeps everything), fill every pinhole candidate when asked.
function fixedCleanupPlan(options: TraceOptions, binaryMask: boolean): SmallMarkCleanupPlan {
  const area = supersampleArea(options);
  const minPixels = (options.despeckleMinPixels ?? 0) * area;
  return {
    ink: binaryMask && minPixels > area ? { minPixels } : null,
    holes: options.fillPinholeCracks === true ? {} : null,
  };
}

function binaryInk(image: RawImageData): Uint8Array {
  const ink = new Uint8Array(image.width * image.height);
  for (let p = 0; p < ink.length; p += 1) ink[p] = (image.data[p * 4] ?? 255) < 128 ? 1 : 0;
  return ink;
}

// Mask px² per source px² from supersampling (pixelScale²).
function supersampleArea(options: TraceOptions): number {
  const scale = options.pixelScale ?? 1;
  return Number.isFinite(scale) && scale >= 1 ? scale * scale : 1;
}

// The bounded downscale route's working/source area ratio.
function workingArea(options: TraceOptions): number {
  const ratio = options.smallMarkAreaScale ?? 1;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export type SmallMarkClassifier = {
  /** Ink regions smaller than this (mask px) are judged; larger ones stay. */
  readonly inkCandidateAreaPx: number;
  /** true = keep this ink region. `ink` is the mask the region came from. */
  readonly keepInkMark: (region: ReadonlyArray<number>, ink: Uint8Array) => boolean;
  /** true = fill this enclosed paper component (already a pinhole candidate). */
  readonly fillPaperHole: (component: ReadonlyArray<number>) => boolean;
};

export type SmallMarkClassifierInput = {
  readonly width: number;
  readonly height: number;
  /** The binary mask (1 = ink) the cleanup starts from. */
  readonly ink: Uint8Array;
  /** Pre-threshold luma; null = binary evidence only (alpha masks). */
  readonly field: CrackSubPixelField | null;
  /** Mask px² per source px². */
  readonly areaScale: number;
};

export function createSmallMarkClassifier(input: SmallMarkClassifierInput): SmallMarkClassifier {
  const { width, height, field } = input;
  const areaScale = Number.isFinite(input.areaScale) && input.areaScale > 0 ? input.areaScale : 1;
  const linearScale = Math.sqrt(areaScale);
  const minArea = AUTO_MIN_MARK_AREA_PX * areaScale;
  const isolatedMinArea = AUTO_ISOLATED_MARK_MIN_AREA_PX * areaScale;
  const supportPx = AUTO_SUPPORT_RADIUS_PX * linearScale;
  const tones = field === null ? null : measureTones(input.ink, field, width);
  // Per-call stamp so "is this pixel in the region being judged" is O(1)
  // without clearing a buffer between regions.
  const stamp = new Uint32Array(width * height);
  let current = 0;
  const geometry: Geometry = {
    width,
    height,
    ringPx: Math.max(1, Math.round(linearScale)),
    stamp,
    current: () => current,
  };
  const mark = (pixels: ReadonlyArray<number>): void => {
    current += 1;
    for (const p of pixels) stamp[p] = current;
  };
  // Built on first use (a hole-only plan never needs it). `ink` is the
  // pre-erasure mask despeckle hands every judgement; it is the same array
  // each time.
  let around: InkNeighbourhood | null = null;
  const neighbourhood = (ink: Uint8Array): InkNeighbourhood => {
    around ??= createInkNeighbourhood({
      width,
      height,
      ink,
      field,
      bridgeLuma: tones === null ? null : tones.paper - AUTO_BRIDGE_FRACTION * tones.span,
      reach: (pixels) =>
        field === null || tones === null ? 1 : reachOf(pixels, field, width, tones) / tones.span,
      minArea,
      isolatedMinArea,
      likeMaxArea: AUTO_LIKE_MARK_MAX_AREA_PX * areaScale,
      supportPx,
      tilePx: AUTO_DEBRIS_TILE_PX * linearScale,
    });
    return around;
  };

  return {
    inkCandidateAreaPx: AUTO_CANDIDATE_AREA_PX * areaScale,
    keepInkMark: (region, ink) => {
      if (region.length < minArea) return false;
      mark(region);
      if (field !== null && tones !== null) {
        const e = extremes(region, field, geometry, 'ink');
        if (!toneIsGenuine(tones.paper - e.value, e.cut - e.value, e.ring - e.value, tones)) {
          return false;
        }
      }
      const around = neighbourhood(ink);
      if (around.bridged(region)) return true;
      if (around.debrisAround(region) >= AUTO_DUST_MIN_DEBRIS) return false;
      if (region.length >= isolatedMinArea) return true;
      const support = around.support(region);
      return support.like <= supportPx && support.like <= support.stroke;
    },
    fillPaperHole: (component) => {
      if (component.length < minArea) return true;
      if (field === null || tones === null) return false;
      mark(component);
      const e = extremes(component, field, geometry, 'paper');
      return !toneIsGenuine(e.value - tones.ink, e.value - e.cut, e.value - e.ring, tones);
    },
  };
}

type Tones = { readonly ink: number; readonly paper: number; readonly span: number };

// reach: from the opposite tone to the mark's extreme; margin: past the cut;
// contrast: against its ring. All in luma levels, positive = mark-like.
function toneIsGenuine(reach: number, margin: number, contrast: number, tones: Tones): boolean {
  return (
    reach >= AUTO_MIN_REACH_FRACTION * tones.span &&
    margin >= AUTO_MIN_CUT_MARGIN_FRACTION * tones.span &&
    contrast >= AUTO_MIN_CONTRAST_FRACTION * tones.span
  );
}

type Geometry = {
  readonly width: number;
  readonly height: number;
  readonly ringPx: number;
  readonly stamp: Uint32Array;
  readonly current: () => number;
};

// Median field luma of mask ink and of mask paper.
function measureTones(ink: Uint8Array, field: CrackSubPixelField, width: number): Tones {
  const inkHist = new Uint32Array(256);
  const paperHist = new Uint32Array(256);
  for (let p = 0; p < ink.length; p += 1) {
    const x = p % width;
    const luma = clampLuma(field.lumaAt(x, (p - x) / width));
    const hist = ink[p] === 1 ? inkHist : paperHist;
    hist[luma] = (hist[luma] ?? 0) + 1;
  }
  const inkTone = histogramMedian(inkHist, 0);
  const paperTone = histogramMedian(paperHist, 255);
  return {
    ink: inkTone,
    paper: paperTone,
    span: Math.max(MIN_TONE_SPAN_LUMA, paperTone - inkTone),
  };
}

function histogramMedian(hist: Uint32Array, fallback: number): number {
  let total = 0;
  for (const count of hist) total += count;
  if (total === 0) return fallback;
  let seen = 0;
  for (let luma = 0; luma < hist.length; luma += 1) {
    seen += hist[luma] ?? 0;
    if (seen * 2 >= total) return luma;
  }
  return fallback;
}

// An ink mark's darkest luma (a hole's brightest), the cut at that pixel,
// and the opposite extreme of its ring (brightest ring pixel for ink,
// darkest for a hole).
function extremes(
  region: ReadonlyArray<number>,
  field: CrackSubPixelField,
  g: Geometry,
  polarity: 'ink' | 'paper',
): { readonly value: number; readonly cut: number; readonly ring: number } {
  // Work in sign·luma so both polarities look for the same minimum.
  const sign = polarity === 'ink' ? 1 : -1;
  let value = Number.POSITIVE_INFINITY;
  let cut = 0;
  let ring = Number.NEGATIVE_INFINITY;
  forRegionAndRing(region, g, (x, y, inRegion) => {
    const v = sign * field.lumaAt(x, y);
    if (!inRegion) {
      if (v > ring) ring = v;
    } else if (v < value) {
      value = v;
      cut = field.thresholdAt(x, y);
    }
  });
  if (ring === Number.NEGATIVE_INFINITY) ring = value; // the region fills the image
  return { value: sign * value, cut, ring: sign * ring };
}

// Visit each region pixel, and each in-image pixel within ringPx (Chebyshev)
// of one that is not itself in the region. Ring pixels may repeat; the
// callers only take extremes.
function forRegionAndRing(
  region: ReadonlyArray<number>,
  g: Geometry,
  visit: (x: number, y: number, inRegion: boolean) => void,
): void {
  const id = g.current();
  for (const p of region) {
    const x = p % g.width;
    const y = (p - x) / g.width;
    visit(x, y, true);
    for (let dy = -g.ringPx; dy <= g.ringPx; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= g.height) continue;
      for (let dx = -g.ringPx; dx <= g.ringPx; dx += 1) {
        const nx = x + dx;
        if (nx < 0 || nx >= g.width) continue;
        if (g.stamp[ny * g.width + nx] !== id) visit(nx, ny, false);
      }
    }
  }
}

// How far a component's darkest pixel gets from paper toward ink, in luma.
function reachOf(
  pixels: ReadonlyArray<number>,
  field: CrackSubPixelField,
  width: number,
  tones: Tones,
): number {
  let darkest = Number.POSITIVE_INFINITY;
  for (const p of pixels) {
    const x = p % width;
    darkest = Math.min(darkest, field.lumaAt(x, (p - x) / width));
  }
  return tones.paper - darkest;
}

function clampLuma(value: number): number {
  if (!Number.isFinite(value)) return 255;
  return Math.max(0, Math.min(255, Math.round(value)));
}
