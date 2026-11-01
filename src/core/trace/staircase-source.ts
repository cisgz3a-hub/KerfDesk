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
// tail models it. Each source pixel takes the class of the enlarged pixel at
// its centre: a nearest-neighbour enlargement's block, and on a 3x grid the
// centre of the block, which the bilinear rounding of a corner never reaches.
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

import { inkMaskFromPrepared } from './centerline';
import type { CrackSubPixelField } from './contour-boundary';
import { contourTraceInputMatches, type ContourTraceInput } from './contour-input';
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
  const counts = boundaryCrackCounts(inkMaskFromPrepared(native.prepared), native.crackField);
  return counts.cracks > 0 && counts.measured <= STAIRCASE_MAX_MEASURED_FRACTION * counts.cracks;
}

/** The source-grid input for a two-level source: its own field and options,
 *  with the mask the enlarged grid's cleanup left, sampled at each source
 *  pixel centre. Its step cracks sit at their midpoints (stepField). */
export function staircaseSourceInput(
  native: ContourTraceInput,
  enlarged: ContourTraceInput,
): ContourTraceInput {
  const { width, height } = native.prepared;
  const working = enlarged.prepared;
  const scaleX = working.width / width;
  const scaleY = working.height / height;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const wy = Math.min(working.height - 1, Math.floor((y + 0.5) * scaleY));
    for (let x = 0; x < width; x += 1) {
      const wx = Math.min(working.width - 1, Math.floor((x + 0.5) * scaleX));
      const from = (wy * working.width + wx) * 4;
      data.set(working.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  const { median: _released, ...input } = native;
  const prepared = { ...native.prepared, data };
  const field = native.crackField === null ? null : stepField(native.crackField, prepared);
  return { ...input, prepared, crackField: field };
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
  const mid = plateauMidLevel(inkMaskFromPrepared(prepared), field);
  return {
    ...field,
    crackCrossingAt: (inkX, inkY, bgX, bgY) =>
      isStepCrack(field.lumaAt(inkX, inkY), field.lumaAt(bgX, bgY), mid)
        ? MID_CRACK
        : field.crackCrossingAt?.(inkX, inkY, bgX, bgY),
  };
}

type InkPlane = { readonly width: number; readonly height: number; readonly ink: Uint8Array };

// Every ink/paper crack of the mask, the image border included (off-grid
// pixels are paper), and how many of them are not a step between the two
// tones.
function boundaryCrackCounts(
  mask: InkPlane,
  field: CrackSubPixelField,
): { readonly cracks: number; readonly measured: number } {
  const { width, height } = mask;
  const inkAt = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask.ink[y * width + x] === 1;
  const mid = plateauMidLevel(mask, field);
  let cracks = 0;
  let measured = 0;
  const visit = (ax: number, ay: number, bx: number, by: number): void => {
    const aInk = inkAt(ax, ay);
    if (aInk === inkAt(bx, by)) return;
    cracks += 1;
    const step = aInk
      ? isStepCrack(field.lumaAt(ax, ay), field.lumaAt(bx, by), mid)
      : isStepCrack(field.lumaAt(bx, by), field.lumaAt(ax, ay), mid);
    if (!step) measured += 1;
  };
  for (let y = -1; y < height; y += 1) {
    for (let x = -1; x < width; x += 1) {
      visit(x, y, x + 1, y);
      visit(x, y, x, y + 1);
    }
  }
  return { cracks, measured };
}

// A crack between ink luma `ink` and paper luma `paper` is a step when the
// two straddle the mid-level and cross it within the tolerance of halfway.
function isStepCrack(ink: number, paper: number, mid: number): boolean {
  if (!(paper > mid && ink <= mid)) return false;
  return Math.abs((paper - mid) / (paper - ink) - MID_CRACK) <= STEP_CROSSING_TOLERANCE;
}

// Halfway between the median ink and the median paper value: the two tones.
// In most art edge pixels are a minority of either class and leave a median
// where it is; in hairline art they set the ink tone its steps share.
function plateauMidLevel(mask: InkPlane, field: CrackSubPixelField): number {
  const ink = new Uint32Array(MAX_LEVEL + 1);
  const paper = new Uint32Array(MAX_LEVEL + 1);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const level = Math.max(0, Math.min(MAX_LEVEL, Math.round(field.lumaAt(x, y))));
      const counts = mask.ink[y * mask.width + x] === 1 ? ink : paper;
      counts[level] = (counts[level] as number) + 1;
    }
  }
  return (medianLevel(ink, 0) + medianLevel(paper, MAX_LEVEL)) / 2;
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
