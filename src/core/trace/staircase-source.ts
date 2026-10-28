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

import { inkMaskFromPrepared } from './centerline';
import { crackCarriesSubPixelEdge, type CrackSubPixelField } from './contour-boundary';
import { contourTraceInputMatches, type ContourTraceInput } from './contour-input';
import { prepareTraceForContour, type RawImageData, type TraceOptions } from './trace-image';

// The share of a source's boundary cracks that may carry a sub-pixel edge
// while it still counts as two-level: a few grey pixels (a stray anti-aliased
// mark, a soft corner) do not make the rest of the art a measurement.
const STAIRCASE_MAX_MEASURED_FRACTION = 0.02;

/** True when, on the source's own grid, almost no boundary crack carries a
 *  sub-pixel edge: the walker would trace every loop as a binary staircase. */
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
 *  pixel centre. */
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
  return { ...input, prepared: { ...native.prepared, data } };
}

type InkPlane = { readonly width: number; readonly height: number; readonly ink: Uint8Array };

// Every ink/paper crack of the mask, the image border included (off-grid
// pixels are paper), and how many of them the walker would interpolate.
function boundaryCrackCounts(
  mask: InkPlane,
  field: CrackSubPixelField,
): { readonly cracks: number; readonly measured: number } {
  const { width, height } = mask;
  const inkAt = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask.ink[y * width + x] === 1;
  let cracks = 0;
  let measured = 0;
  const visit = (ax: number, ay: number, bx: number, by: number): void => {
    const aInk = inkAt(ax, ay);
    if (aInk === inkAt(bx, by)) return;
    cracks += 1;
    const edge = aInk
      ? crackCarriesSubPixelEdge(field, ax, ay, bx, by)
      : crackCarriesSubPixelEdge(field, bx, by, ax, ay);
    if (edge) measured += 1;
  };
  for (let y = -1; y < height; y += 1) {
    for (let x = -1; x < width; x += 1) {
      visit(x, y, x + 1, y);
      visit(x, y, x, y + 1);
    }
  }
  return { cracks, measured };
}
