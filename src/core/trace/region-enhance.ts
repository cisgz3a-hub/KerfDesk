// Region-enhance re-trace: patch one rectangular region of an existing trace
// by re-tracing the SOURCE crop supersampled.
//
// WHY: small features inside a large raster (a ~67px² letter counter in a
// 1024px logo) sit at the tracer's detection floor, and the whole-image
// auto-upscale never fires for large sources (auto-upscale.ts gates on total
// size). Re-tracing just the boxed region at 2x gives the tracer more pixels
// of the same feature — the mkbitmap precedent — and recovers detail the
// full-image pass dropped, without paying for a 1024px 2x buffer.
//
// The merge must survive two traps:
//   * A polyline traced FROM the crop that reaches the crop edge may be a
//     fragment of a larger shape CLIPPED by it.
//   * A polyline of the ORIGINAL trace that crosses the region border (a
//     larger outline passing through the box) must survive untouched.
// Only the region SHRUNK by a margin is replaced: existing polylines fully
// inside it are dropped, re-traced ones fully inside it are merged in (by
// colour), and everything crossing it keeps its original geometry. The crop
// is traced with a padding ring of real neighbouring pixels (ADR-410), so a
// clipped fragment always reaches into the padding and fails that test, and
// pixels near the box edge are filtered with the surroundings the full pass
// saw. region-merge.ts pairs the two traces of a shape that grazes the border
// (bounds within 1 px) so that pair is neither lost nor doubled.
//
// The crop also inherits the full image's Otsu cut and auto-sketch verdict
// (trace-source-decisions.ts); re-deriving them from the crop's own pixels
// made the patch binarise differently from its surroundings.
//
// Pure-core compliant: no I/O, no clock, no random — the tracer itself is
// injected by the caller (the UI passes its worker-backed tracer; tests pass
// a direct core tracer).

import type { ColoredPath } from '../scene';
import { downscaleTracedPaths, upscaleBy } from './auto-upscale';
import { edgeMaskRadiusPx } from './edge-input';
import { replacePathsInRegion } from './region-merge';
import { cropRawImageData, normalizeTraceBoundary, offsetColoredPaths } from './trace-boundary';
import type { TraceBoundary } from './trace-boundary';
import {
  SKETCH_RADIUS_PX,
  effectivePixelScale,
  type RawImageData,
  type TraceOptions,
} from './trace-image';
import { resolveFrozenTraceSourceOptions } from './trace-source-decisions';
import { fitsTraceWorkingPixelBudget } from './trace-work-budget';

export { replacePathsInRegion } from './region-merge';

// 2x is mkbitmap's documented sweet spot ("a greyscale image contains more
// detail than a bilevel image at the same resolution"); 3x+ invents detail.
// The whole-image small-source path may go to 3x for tiny imports, but a
// region crop is user-boxed detail inside real art — stay at 2x.
const REGION_UPSCALE_FACTOR = 2;

// Border ring treated as "possibly clipped" on both sides of the merge. Wide
// enough to catch crop-edge fragments (their vertices sit within a pixel of
// the border), narrow enough that a generously-boxed feature is unaffected.
const REGION_EDGE_MARGIN_PX = 1;

/** The injected tracer: same contract as traceImageToColoredPaths. */
export type RegionTraceFn = (image: RawImageData, options: TraceOptions) => Promise<ColoredPath[]>;

export type EnhanceRegionArgs = {
  /** Full source raster the original trace came from. */
  readonly image: RawImageData;
  /** User-boxed region, in source-image pixels. */
  readonly region: TraceBoundary;
  /** The existing full-image trace result to patch. */
  readonly fullTracePaths: ReadonlyArray<ColoredPath>;
  /** Trace options — use the same merged options as the full trace. */
  readonly options: TraceOptions;
  readonly trace: RegionTraceFn;
};

/** Supersample factor for a region crop: 2x unless that would exceed the
 *  upscale pixel budget, then 1 (trace the crop at native size). */
export function computeRegionUpscaleFactor(crop: RawImageData, options: TraceOptions): number {
  return fitsTraceWorkingPixelBudget(crop, REGION_UPSCALE_FACTOR, options)
    ? REGION_UPSCALE_FACTOR
    : 1;
}

/** Re-trace `region` of `image` supersampled and return `fullTracePaths` with
 *  the region's interior replaced by the re-traced geometry. A degenerate or
 *  out-of-image region returns the input paths unchanged.
 *
 *  `fullTracePaths` must come from the same frozen decisions: pass options
 *  from resolveFrozenTraceSourceOptions(image, ...) to the full trace too. */
export async function enhanceRegionPaths(args: EnhanceRegionArgs): Promise<ColoredPath[]> {
  const region = normalizeTraceBoundary(args.region, args.image.width, args.image.height);
  if (region === null) return [...args.fullTracePaths];
  // Otsu's cut and the auto-sketch trigger are whole-image decisions; a crop
  // must inherit them, not re-derive them from its own pixels (ADR-410).
  const options = resolveFrozenTraceSourceOptions(args.image, args.options);
  // Trace the box with the neighbourhood its filters read, so pixels near the
  // box edge see the same surroundings as in the full pass. Subpaths reaching
  // into the padding never pass the merge's interior test.
  const padded = padRegion(region, regionContextPx(options), args.image);
  const crop = cropRawImageData(args.image, padded);
  const factor = computeRegionUpscaleFactor(crop, options);
  const traced = await args.trace(
    factor > 1 ? upscaleBy(crop, factor) : crop,
    optionsForRegionScale(options, factor),
  );
  const inSource = offsetColoredPaths(downscaleTracedPaths(traced, factor), padded.x, padded.y);
  return replacePathsInRegion(
    args.fullTracePaths,
    shrinkRegion(region, REGION_EDGE_MARGIN_PX),
    inSource,
  );
}

// Widest neighbourhood a luma lane reads around a pixel, in this image's
// pixels: the sketch / auto-detail / faint-line window (which also covers the
// 3x3 median and the auto median's two-link support), or Edge Detection's
// local-contrast window. One more pixel covers bilinear upscaling's reach.
function regionContextPx(options: TraceOptions): number {
  const sketch = SKETCH_RADIUS_PX * effectivePixelScale(options);
  const edge = options.traceMode === 'edge' ? edgeMaskRadiusPx(options) : 0;
  return Math.ceil(Math.max(sketch, edge)) + 1;
}

function padRegion(region: TraceBoundary, pad: number, image: RawImageData): TraceBoundary {
  const x = Math.max(0, region.x - pad);
  const y = Math.max(0, region.y - pad);
  return {
    x,
    y,
    width: Math.min(image.width, region.x + region.width + pad) - x,
    height: Math.min(image.height, region.y + region.height + pad) - y,
  };
}

function optionsForRegionScale(options: TraceOptions, factor: number): TraceOptions {
  if (factor <= 1) return options;
  const priorScale =
    options.pixelScale !== undefined && Number.isFinite(options.pixelScale)
      ? Math.max(1, options.pixelScale)
      : 1;
  return {
    ...options,
    autoUpscaleSmallSources: false,
    pixelScale: priorScale * factor,
    supersampleContour: false,
    upscaleSmallSmoothSources: false,
  };
}

function shrinkRegion(region: TraceBoundary, marginPx: number): TraceBoundary {
  return {
    x: region.x + marginPx,
    y: region.y + marginPx,
    width: Math.max(0, region.width - 2 * marginPx),
    height: Math.max(0, region.height - 2 * marginPx),
  };
}
