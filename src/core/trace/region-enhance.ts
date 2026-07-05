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
//   * Every polyline traced FROM the crop lies inside the crop by
//     construction, so containment alone cannot tell a genuine re-traced
//     shape from a fragment of a larger shape CLIPPED by the crop edge.
//     Fragments hug the region border; genuine shapes sit inside it.
//   * A polyline of the ORIGINAL trace that crosses the region border (a
//     larger outline passing through the box) must survive untouched.
// Both are solved with one rule: only the region SHRUNK by a margin is
// replaced. Existing polylines fully inside the shrunk region are dropped;
// replacement polylines fully inside it are merged in (by colour); everything
// in the margin ring or crossing the border keeps its original geometry.
//
// Pure-core compliant: no I/O, no clock, no random — the tracer itself is
// injected by the caller (the UI passes its worker-backed tracer; tests pass
// a direct core tracer).

import type { ColoredPath, Polyline } from '../scene';
import { downscaleTracedPaths, MAX_UPSCALE_SOURCE_PIXELS, upscaleBy } from './auto-upscale';
import { cropRawImageData, normalizeTraceBoundary, offsetColoredPaths } from './trace-boundary';
import type { TraceBoundary } from './trace-boundary';
import type { RawImageData, TraceOptions } from './trace-image';

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
export function computeRegionUpscaleFactor(crop: RawImageData): number {
  const upscaledPixels = crop.width * REGION_UPSCALE_FACTOR * (crop.height * REGION_UPSCALE_FACTOR);
  return upscaledPixels > MAX_UPSCALE_SOURCE_PIXELS ? 1 : REGION_UPSCALE_FACTOR;
}

/** Re-trace `region` of `image` supersampled and return `fullTracePaths` with
 *  the region's interior replaced by the re-traced geometry. A degenerate or
 *  out-of-image region returns the input paths unchanged. */
export async function enhanceRegionPaths(args: EnhanceRegionArgs): Promise<ColoredPath[]> {
  const region = normalizeTraceBoundary(args.region, args.image.width, args.image.height);
  if (region === null) return [...args.fullTracePaths];
  const crop = cropRawImageData(args.image, region);
  const factor = computeRegionUpscaleFactor(crop);
  const traced = await args.trace(factor > 1 ? upscaleBy(crop, factor) : crop, args.options);
  const inSource = offsetColoredPaths(downscaleTracedPaths(traced, factor), region.x, region.y);
  const interior = shrinkRegion(region, REGION_EDGE_MARGIN_PX);
  const replacement = inSource
    .map((path) => ({
      ...path,
      polylines: path.polylines.filter((pl) => polylineFullyInside(pl, interior)),
    }))
    .filter((path) => path.polylines.length > 0);
  return replacePathsInRegion(args.fullTracePaths, interior, replacement);
}

/** Merge: drop existing polylines fully inside `interior`, then add the
 *  replacement polylines, folding them into the first existing path of the
 *  same colour (no duplicate colour layers). Exported for tests. */
export function replacePathsInRegion(
  existing: ReadonlyArray<ColoredPath>,
  interior: TraceBoundary,
  replacement: ReadonlyArray<ColoredPath>,
): ColoredPath[] {
  const out: ColoredPath[] = [];
  const mergedColors = new Set<string>();
  for (const path of existing) {
    const survivors = path.polylines.filter((pl) => !polylineFullyInside(pl, interior));
    const additions = mergedColors.has(path.color)
      ? []
      : replacementPolylines(replacement, path.color);
    mergedColors.add(path.color);
    const polylines = [...survivors, ...additions];
    if (polylines.length > 0) out.push({ color: path.color, polylines });
  }
  for (const path of replacement) {
    if (mergedColors.has(path.color)) continue;
    mergedColors.add(path.color);
    const polylines = replacementPolylines(replacement, path.color);
    if (polylines.length > 0) out.push({ color: path.color, polylines });
  }
  return out;
}

function replacementPolylines(replacement: ReadonlyArray<ColoredPath>, color: string): Polyline[] {
  return replacement.filter((path) => path.color === color).flatMap((path) => [...path.polylines]);
}

function shrinkRegion(region: TraceBoundary, marginPx: number): TraceBoundary {
  return {
    x: region.x + marginPx,
    y: region.y + marginPx,
    width: Math.max(0, region.width - 2 * marginPx),
    height: Math.max(0, region.height - 2 * marginPx),
  };
}

function polylineFullyInside(polyline: Polyline, region: TraceBoundary): boolean {
  if (polyline.points.length === 0) return false;
  const maxX = region.x + region.width;
  const maxY = region.y + region.height;
  return polyline.points.every(
    (p) => p.x >= region.x && p.x <= maxX && p.y >= region.y && p.y <= maxY,
  );
}
