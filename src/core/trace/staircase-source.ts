// Two-level sources: the enlargement judges, the source grid draws (ADR-530
// Amendment 11).
//
// The bilinear enlargement (auto-upscale.ts) exists so that grey edges
// re-threshold on a finer grid, and so that the mask cleanup and small-mark
// judge see small and thin detail at a usable size. A source whose every
// edge is a saturated step (a 1-bit scan, a PBM, a hard-edged black-and-white
// logo) has no grey to re-threshold: at 2x the cut mask is exactly the
// nearest-neighbour enlargement, so the finer grid adds no shape. What it adds
// is the ramp the enlargement itself draws across each step. The walker
// interpolates those ramps, its loops count as sub-pixel measurements, and the
// fit follows the pixel staircase they trace (quality audit Q4-P2-1: a 32 px
// circle drew 46 cubics with 40 inflections, against 6 and 0 traced natively).
//
// Such a source keeps the enlarged grid's cleanup (which marks exist, which
// pinholes fill, which thin strokes are restored) and walks that cleaned mask
// back on its own grid, where every crack is a staircase step and the binary
// tail models it. A source pixel takes the enlarged class only when its whole
// block agrees: that is what the cleanup changed, where a block that disagrees
// holds only the ramp the enlargement drew across an edge.
//
// Two-level means two tones meeting in steps, not two exact values (ADR-530
// Amendment 12). A JPEG of such art rings: its edge pixels sit some way off
// both tones, and at quality 75 the cut placed a sub-pixel edge on up to a
// fifth of an image's cracks (rolling audit v8 N8-P2-3). A step between ink
// level I and paper level P still crosses their mid-level (I + P) / 2 halfway
// between the two pixel centres, and JPEG's error at a step is near symmetric,
// so placed against that level its cracks stay within STEP_CROSSING_TOLERANCE
// of the midpoint (q60: at most 1% of any Q4 image's cracks beyond it). An
// anti-aliased edge spreads its crossings across the whole crack (30-90% of
// the cracks beyond it). The mid-level also keeps a step between paper and a
// pale ink (red, at luma 75) a step, where a fixed cut at 128 would place
// every one of its cracks 0.2 px off the midpoint.
//
// A near two-level source in any other tones traces as its clean art (ADR-530
// Amendment 13): its pixels are rewritten to the black and white of its twin
// before any route is chosen, so its scale plan, its enlarged cleanup and its
// fit are that twin's at every size. Judging the art through its own tones on
// the enlarged grid does not work: bilinear reads ink at luma 100 as paper a
// quarter pixel from an edge (a 2 px bar kept 49%), and Line Art's
// local-contrast mask grows a coloured stroke by a pixel. A sheet with two
// inks or a shaded paper has no single pair of tones, so a crack the
// image-wide test refuses is judged against the tones on its own two sides.

import { inkMaskFromPrepared } from './centerline';
import type { CrackSubPixelField } from './contour-boundary';
import { contourTraceInputMatches, type ContourTraceInput } from './contour-input';
import { shouldTraceAlphaMask } from './trace-alpha';
import { prepareTraceForContour, type RawImageData, type TraceOptions } from './trace-image';

// The share of a source's boundary cracks that may carry a sub-pixel edge
// while it still counts as two-level: a few grey pixels (a stray anti-aliased
// mark, a soft corner) do not make the rest of the art a measurement.
const STAIRCASE_MAX_MEASURED_FRACTION = 0.02;
// How far (px) a crack's mid-level crossing may sit from its midpoint while it
// is still a step.
const STEP_CROSSING_TOLERANCE = 0.15;
const MID_CRACK = 0.5;
const MAX_LEVEL = 255;
// The window (px either side) a crack's own two tones are read from: wider than
// the JPEG ringing around an edge, narrow enough to hold one ink and one paper.
const TONE_WINDOW_PX = 3;
// Tones closer than this are a shaded field, not an ink on a paper: a
// gradient's neighbouring levels straddle their own middle at every crack.
const MIN_TONE_CONTRAST = 48;
const RINGING_PASSES = 2;
const MAX_TOLERANCE_WIDENING = 2;

/** True when, on the source's own grid, almost every boundary crack is a step
 *  between the source's two tones: the art has no sub-pixel edge to measure. */
export function isStaircaseSource(
  image: RawImageData,
  options: TraceOptions,
  contourInput?: ContourTraceInput,
): boolean {
  const native =
    contourInput !== undefined &&
    (options.pixelScale ?? 1) === 1 &&
    contourTraceInputMatches(contourInput, image, options)
      ? contourInput
      : prepareTraceForContour(image, { ...options, pixelScale: 1 });
  if (native.crackField === null) return false;
  const mask = inkMaskFromPrepared(native.prepared);
  const cracks = crackCount(mask);
  return passesStepShare(mask, sheetTones(mask, native.crackField), native.crackField, cracks);
}

/** A source two-level in tones other than black and white, rewritten as its
 *  clean art, with the options its black-and-white twin is traced under. Null
 *  when the source already is that art, is not two-level, or its mask does not
 *  come from one cut through its luma. */
export function cleanStaircaseSource(
  image: RawImageData,
  options: TraceOptions,
  native: ContourTraceInput,
): { readonly image: RawImageData; readonly options: TraceOptions } | null {
  const field = native.crackField;
  if (field === null || refusesCleanArt(image, options)) return null;
  const mask = withRingingInk(inkMaskFromPrepared(native.prepared), field);
  const cracks = crackCount(mask);
  const tones = [sheetTones(mask, field), crackTones(mask, field)].find((candidate) =>
    passesStepShare(mask, candidate, field, cracks),
  );
  if (tones === undefined) return null;
  return { image: cleanArt(mask, field, tones), options: { ...options, ...CLEAN_ART_OPTIONS } };
}

/** True when the source cannot trace as clean art whatever its preparation
 *  finds, so a caller can skip preparing it for the check. */
export function refusesCleanArt(image: RawImageData, options: TraceOptions): boolean {
  if (isCleanArt(image)) return true;
  if ((options.cutoffLuma ?? 0) !== 0 || shouldTraceAlphaMask(image, options)) return true;
  // Faint lines and Sketch are detectors the operator chose, each with its own
  // reading of what is ink; they are not one cut through the luma.
  return options.faintLineRecovery === true || options.sketchTrace === true;
}

// A fixed cut sits close above a mid-grey ink, and a JPEG's ringing lifts that
// ink's edge pixels over it: at luma 100 the mask's own holes then fail the step
// test. A paper pixel beside ink that is still on the ink's side of the tones'
// mid-level is ink. It takes two passes for a ringing lobe two pixels deep, and
// goes no further, so a second, paler ink elsewhere on the sheet stays out.
function withRingingInk(mask: InkPlane, field: CrackSubPixelField): InkPlane {
  const { width, height } = mask;
  const { ink: inkTone, paper: paperTone } = plateauTones(mask, field);
  const mid = (inkTone + paperTone) / 2;
  let ink = mask.ink;
  for (let pass = 0; pass < RINGING_PASSES; pass += 1) {
    const from = ink;
    const next = Uint8Array.from(from);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        // Most paper touches no ink: test that before reading the field.
        if (from[p] === 1 || !touchesInk(from, p, x, y, mask)) continue;
        if (field.lumaAt(x, y) <= mid) next[p] = 1;
      }
    }
    ink = next;
  }
  return { width, height, ink };
}

// The tone chain and the median have already run in the field the art is read
// from, and black and white holds no colour for the local-contrast lane to find.
const CLEAN_ART_OPTIONS: Partial<TraceOptions> = {
  brightness: 0,
  contrast: 0,
  gamma: 1,
  invert: false,
  medianFilter: false,
  sourceAutoSketch: false,
};

function isCleanArt(image: RawImageData): boolean {
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const level = data[i];
    if (level !== 0 && level !== MAX_LEVEL) return false;
    if (data[i + 1] !== level || data[i + 2] !== level || data[i + 3] !== MAX_LEVEL) return false;
  }
  return true;
}

// A pixel the luma's own cut calls ink stays ink even where the cleaned mask
// dropped it, so the twin's cleanup judges the same marks. A pixel beside a crack that
// is not a step (a stray soft mark) keeps its ramp between the two tones, so
// that edge stays a measurement.
function cleanArt(mask: InkPlane, field: CrackSubPixelField, tones: CrackTones): RawImageData {
  const { width, height } = mask;
  const data = new Uint8ClampedArray(width * height * 4);
  const setLevel = (x: number, y: number, level: number): void => {
    const offset = (y * width + x) * 4;
    data.fill(level, offset, offset + 3);
    data[offset + 3] = MAX_LEVEL;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inked = field.lumaAt(x, y) <= field.thresholdAt(x, y) || mask.ink[y * width + x] === 1;
      setLevel(x, y, inked ? 0 : MAX_LEVEL);
    }
  }
  forEachCrack(mask, (inkX, inkY, bgX, bgY) => {
    const { ink, paper } = tones(inkX, inkY);
    if (isToneStep(field.lumaAt(inkX, inkY), field.lumaAt(bgX, bgY), ink, paper)) return;
    for (const [x, y] of [
      [inkX, inkY],
      [bgX, bgY],
    ] as const) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      setLevel(x, y, (MAX_LEVEL * (field.lumaAt(x, y) - ink)) / Math.max(1, paper - ink));
    }
  });
  return { width, height, data };
}

function touchesInk(ink: Uint8Array, p: number, x: number, y: number, mask: InkPlane): boolean {
  const { width, height } = mask;
  return (
    (x > 0 && ink[p - 1] === 1) ||
    (x + 1 < width && ink[p + 1] === 1) ||
    (y > 0 && ink[p - width] === 1) ||
    (y + 1 < height && ink[p + width] === 1)
  );
}

/** The source-grid input for a two-level source: its own field and options,
 *  with the mask the enlarged grid's cleanup left. A source pixel changes class
 *  only when the cleanup changed its whole enlarged block. Its step cracks sit
 *  at their midpoints (stepField). */
export function staircaseSourceInput(
  native: ContourTraceInput,
  enlarged: ContourTraceInput,
): ContourTraceInput {
  const { width, height } = native.prepared;
  const working = enlarged.prepared;
  const scaleX = working.width / width;
  const scaleY = working.height / height;
  const data = Uint8ClampedArray.from(native.prepared.data);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const level = enlargedBlockLevel(working, x * scaleX, y * scaleY, scaleX, scaleY);
      if (level !== null) data.fill(level, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  const { median: _released, ...input } = native;
  const prepared = { ...native.prepared, data };
  const field = native.crackField === null ? null : stepField(native.crackField, prepared);
  return { ...input, prepared, crackField: field };
}

// The level every enlarged pixel of a source pixel's block agrees on, if any.
function enlargedBlockLevel(
  working: RawImageData,
  left: number,
  top: number,
  scaleX: number,
  scaleY: number,
): number | null {
  const x0 = Math.min(working.width - 1, Math.round(left));
  const y0 = Math.min(working.height - 1, Math.round(top));
  const x1 = Math.min(working.width, Math.max(x0 + 1, Math.round(left + scaleX)));
  const y1 = Math.min(working.height, Math.max(y0 + 1, Math.round(top + scaleY)));
  const level = working.data[(y0 * working.width + x0) * 4] as number;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (working.data[(y * working.width + x) * 4] !== level) return null;
    }
  }
  return level;
}

// The walker places a crack where the field crosses the cut, and on a step
// that crossing says nothing about the edge. Off the tones' mid-level it is
// the cut's own bias: a fixed cut at 128 puts every crack of a disc in ink at
// luma 80 0.2 px off its midpoint, the loop reads as a measurement and its fit
// follows the staircase (10 segments where black ink draws 6). On a JPEG it
// is the ringing: placed even at the mid-level, quality 60 moves the cracks up
// to 0.15 px, enough to tilt short binary legs into serif spikes (72 glyph
// images: 50 spikes, against 11 on the clean art). So a step crack crosses at
// its midpoint, as a saturated step does, and a near two-level source traces
// as its clean art. Cracks that are not steps keep the field's crossing.
function stepField(field: CrackSubPixelField, prepared: RawImageData): CrackSubPixelField {
  const mask = inkMaskFromPrepared(prepared);
  const { ink: inkTone, paper: paperTone } = plateauTones(mask, field);
  const mid = (inkTone + paperTone) / 2;
  return {
    ...field,
    crackCrossingAt: (inkX, inkY, bgX, bgY) =>
      isStepCrack(field.lumaAt(inkX, inkY), field.lumaAt(bgX, bgY), mid)
        ? MID_CRACK
        : field.crackCrossingAt?.(inkX, inkY, bgX, bgY),
  };
}

type InkPlane = { readonly width: number; readonly height: number; readonly ink: Uint8Array };

// The ink and paper tones a crack is judged against, read at its ink pixel.
type CrackTones = (inkX: number, inkY: number) => { readonly ink: number; readonly paper: number };

function sheetTones(mask: InkPlane, field: CrackSubPixelField): CrackTones {
  const tones = plateauTones(mask, field);
  return () => tones;
}

// The median ink and paper levels in a window around the crack. A window with
// no paper on the grid reads white, as the walker reads off-grid pixels.
function crackTones(mask: InkPlane, field: CrackSubPixelField): CrackTones {
  const { width, height } = mask;
  const side = 2 * TONE_WINDOW_PX + 1;
  const ink = new Uint8Array(side * side);
  const paper = new Uint8Array(side * side);
  return (inkX, inkY) => {
    let inks = 0;
    let papers = 0;
    const y1 = Math.min(height - 1, inkY + TONE_WINDOW_PX);
    const x1 = Math.min(width - 1, inkX + TONE_WINDOW_PX);
    for (let y = Math.max(0, inkY - TONE_WINDOW_PX); y <= y1; y += 1) {
      for (let x = Math.max(0, inkX - TONE_WINDOW_PX); x <= x1; x += 1) {
        const level = field.lumaAt(x, y);
        if (mask.ink[y * width + x] === 1) {
          ink[inks] = level;
          inks += 1;
        } else {
          paper[papers] = level;
          papers += 1;
        }
      }
    }
    return {
      ink: medianOf(ink.subarray(0, inks), 0),
      paper: medianOf(paper.subarray(0, papers), MAX_LEVEL),
    };
  };
}

function medianOf(levels: Uint8Array, empty: number): number {
  if (levels.length === 0) return empty;
  levels.sort();
  return levels[levels.length >> 1] as number;
}

// Every ink/paper crack of the mask, the image border included (off-grid
// pixels are paper): from each pixel, the crack to its right, then the one
// below it. A visit returning false stops the walk. Indexed directly, as this
// walks every pixel of a page (perf audit S5-P3-1).
function forEachCrack(
  mask: InkPlane,
  visit: (inkX: number, inkY: number, bgX: number, bgY: number) => unknown,
): void {
  const { width, height, ink } = mask;
  for (let y = -1; y < height; y += 1) {
    const row = y * width;
    const below = y + 1 < height;
    for (let x = -1; x < width; x += 1) {
      const here = y >= 0 && x >= 0 && ink[row + x] === 1;
      const right = y >= 0 && x + 1 < width && ink[row + x + 1] === 1;
      if (here !== right && (here ? visit(x, y, x + 1, y) : visit(x + 1, y, x, y)) === false) {
        return;
      }
      const down = below && x >= 0 && ink[row + width + x] === 1;
      if (here !== down && (here ? visit(x, y, x, y + 1) : visit(x, y + 1, x, y)) === false) {
        return;
      }
    }
  }
}

function crackCount(mask: InkPlane): number {
  let cracks = 0;
  forEachCrack(mask, () => {
    cracks += 1;
  });
  return cracks;
}

// True when all but the allowed share of the mask's cracks are steps between
// their tones. Stops at the first crack past the share, so a photograph is
// refused after a few per cent of its cracks.
function passesStepShare(
  mask: InkPlane,
  tones: CrackTones,
  field: CrackSubPixelField,
  cracks: number,
): boolean {
  const allowed = STAIRCASE_MAX_MEASURED_FRACTION * cracks;
  let measured = 0;
  forEachCrack(mask, (inkX, inkY, bgX, bgY) => {
    const { ink, paper } = tones(inkX, inkY);
    if (isToneStep(field.lumaAt(inkX, inkY), field.lumaAt(bgX, bgY), ink, paper)) return true;
    measured += 1;
    return measured <= allowed;
  });
  return cracks > 0 && measured <= allowed;
}

// A JPEG's error is a number of levels, whatever the contrast, so the tolerance
// that holds for black on white widens as the two tones draw together. Linear
// in the contrast left a quality 60 disc at luma 80 on the staircase; an
// anti-aliased edge still spreads well past the square's cap (ADR-530 Amendment
// 13).
function isToneStep(ink: number, paper: number, inkTone: number, paperTone: number): boolean {
  const contrast = paperTone - inkTone;
  if (contrast < MIN_TONE_CONTRAST) return false;
  const tolerance =
    STEP_CROSSING_TOLERANCE * Math.min(MAX_TOLERANCE_WIDENING, (MAX_LEVEL / contrast) ** 2);
  return isStepCrack(ink, paper, (inkTone + paperTone) / 2, tolerance);
}

// A crack between ink luma `ink` and paper luma `paper` is a step when the
// two straddle the mid-level and cross it within the tolerance of halfway.
function isStepCrack(
  ink: number,
  paper: number,
  mid: number,
  tolerance = STEP_CROSSING_TOLERANCE,
): boolean {
  if (!(paper > mid && ink <= mid)) return false;
  return Math.abs((paper - mid) / (paper - ink) - MID_CRACK) <= tolerance;
}

// In most art edge pixels are a minority of either class and leave a median
// where it is; in hairline art they set the ink tone its steps share.
function plateauTones(
  mask: InkPlane,
  field: CrackSubPixelField,
): { readonly ink: number; readonly paper: number } {
  const ink = new Uint32Array(MAX_LEVEL + 1);
  const paper = new Uint32Array(MAX_LEVEL + 1);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const level = Math.max(0, Math.min(MAX_LEVEL, Math.round(field.lumaAt(x, y))));
      const counts = mask.ink[y * mask.width + x] === 1 ? ink : paper;
      counts[level] = (counts[level] as number) + 1;
    }
  }
  return { ink: medianLevel(ink, 0), paper: medianLevel(paper, MAX_LEVEL) };
}

function medianLevel(counts: Uint32Array, empty: number): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return empty;
  let seen = 0;
  for (let level = 0; level <= MAX_LEVEL; level += 1) {
    seen += counts[level] as number;
    if (2 * seen >= total) return level;
  }
  return empty;
}
