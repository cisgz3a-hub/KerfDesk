// 3D Sliced image mode (ADR-699), after LightBurn's "3D Sliced" mode.
//
// The image is a depth map: a pixel's brightness says how deep to burn, not
// how dark. With N slices (the operation's pass count), each pixel is in
// round(N * darkness / 255) of them, so white is never burned and black is
// burned on every pass. Pass k (0-based) burns every pixel in at least N - k
// slices, at the operation's full power, so the burned area grows pass by
// pass: the darkest pixels first, lighter ones joining later, as LightBurn's
// preview shows. Each pass is a plain threshold raster; depth comes from how
// many of them a pixel is in.
//
// Pure-core: no clock, random or I/O.

const WHITE = 255;

/** Slice count of an operation's pass count, at least 1. A byte-deep image
 * tells 255 depths apart; more slices repeat some of them, so the darkest
 * pixel is still burned on every pass and depth stays proportional. */
export function imageSliceCount(passes: number): number {
  if (!Number.isFinite(passes)) return 1;
  return Math.max(1, Math.floor(passes));
}

/** How many of `slices` slices a pixel of this darkness (0 white .. 255 black) is in. */
export function sliceDepthOf(darkness: number, slices: number): number {
  const clamped = Math.min(WHITE, Math.max(0, Number.isFinite(darkness) ? darkness : 0));
  return Math.round((clamped * slices) / WHITE);
}

/** Whether pass `passIndex` (0-based) of `slices` burns a pixel this many slices deep. */
export function slicePassBurns(depth: number, passIndex: number, slices: number): boolean {
  return depth > 0 && depth >= slices - passIndex;
}

/**
 * One pass of a sliced depth grid: `sOn` where the pass burns, else 0.
 * `darkness` holds 0 (white) .. 255 (black) per pixel.
 */
export function slicePassValues(
  darkness: ArrayLike<number>,
  passIndex: number,
  slices: number,
  sOn: number,
): Float64Array {
  const out = new Float64Array(darkness.length);
  for (let i = 0; i < darkness.length; i += 1) {
    if (slicePassBurns(sliceDepthOf(darkness[i] ?? 0, slices), passIndex, slices)) out[i] = sOn;
  }
  return out;
}

/** The whole stack seen at once, for previews: S proportional to slice depth. */
export function slicedDepthValue(luma: number, slices: number, sMax: number): number {
  const depth = sliceDepthOf(WHITE - luma, slices);
  return depth === 0 ? 0 : Math.round((sMax * depth) / slices);
}
