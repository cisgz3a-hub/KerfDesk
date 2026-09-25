// Working-grid policy for committed and Multi-File traces (ADR-401).
//
// The live preview decodes to PREVIEW_MAX_EDGE_PX on the longest edge so the
// dialog stays interactive. A commit and a batch trace are one-off work whose
// result is burned, so they choose their grid from the physical output
// instead: the finest grid the machine can use, never finer than the source,
// never coarser than the preview the operator approved, and bounded by an
// estimate of the peak memory the trace needs.
//
// Pure: no DOM, no store. The caller supplies device memory and the project.

import type { DeviceProfile } from '../../core/devices';
import type { RasterImage } from '../../core/scene';
import type { TraceOptions } from '../../core/trace';
import type { ImageDimensions } from './image-loader';
import { PREVIEW_MAX_EDGE_PX, scaleToCap } from './trace-decode-cap';

/** Two samples across the laser spot: a feature narrower than half a spot
 *  cannot be burned as a separate mark, so a finer trace grid gains nothing. */
export const TRACE_SAMPLES_PER_SPOT = 2;
/** Spot used when the device profile does not record one, and for CNC. It is
 *  the default fill line interval (LAYER_DEFAULTS.hatchSpacingMm), so the
 *  default target is 20 px/mm (508 DPI). */
export const DEFAULT_TRACE_SPOT_MM = 0.1;

/** Peak process memory planned per working pixel, by trace lane. Measured as
 *  the rise in peak resident memory while tracing the owl and hummingbird test
 *  art upscaled to 2508 x 2508 (6.3 MP), worst case per lane: filled contours
 *  (Line Art, Smooth, Sharp) 172 B/px, Edge Detection 199 B/px, Centerline
 *  73 B/px; plus 16 B/px for the decode canvas, its pixel copy, the composited
 *  copy and the copy moved to the trace worker. Centerline plans with the
 *  contour figure although it needs less memory: its run time grows fastest
 *  (121 s at 6.3 MP on the owl). ADR-401 has the table. */
export const TRACE_PEAK_BYTES_PER_PIXEL = {
  contour: 190,
  edge: 220,
  centerline: 190,
} as const;
/** Share of the device's memory one trace may plan to use. */
export const TRACE_MEMORY_SHARE = 0.25;
/** Device memory assumed where the browser does not report it (Firefox,
 *  Safari). navigator.deviceMemory is itself capped at 8 in Chromium. */
export const DEFAULT_DEVICE_MEMORY_GB = 4;
/** Absolute ceiling, independent of device memory. */
export const TRACE_MAX_WORKING_PIXELS = 24_000_000;
/** Centerline's ceiling, independent of device memory: its run time grows
 *  fastest, and 6.3 MP is the largest grid with a measured run time (the owl,
 *  121 s). Its memory alone would allow about 11.3 MP with 8 GB. */
export const TRACE_CENTERLINE_MAX_WORKING_PIXELS = 6_000_000;

export type TraceCommitGridLimit = 'native' | 'output' | 'memory' | 'preview';

export type TraceCommitGridPlan = {
  /** The grid the committed trace decodes to and traces on. */
  readonly grid: ImageDimensions;
  /** The longest-edge cap that decodes exactly `grid`. */
  readonly maxEdge: number;
  /** The grid the live preview traces on. */
  readonly preview: ImageDimensions;
  /** The oriented source size. */
  readonly native: ImageDimensions;
  /** Which bound chose the grid. */
  readonly limit: TraceCommitGridLimit;
};

/** What a commit or batch needs to choose its working grid. */
export type TraceCommitGridContext = {
  /** Placed output size of the source, in millimetres; null when unknown. */
  readonly outputMm: { readonly width: number; readonly height: number } | null;
  readonly targetPxPerMm: number;
  /** navigator.deviceMemory where the browser reports it. */
  readonly deviceMemoryGb?: number | undefined;
};

export type TraceCommitGridInput = {
  readonly native: ImageDimensions;
  /** Placed output size; null when unknown (the output bound is skipped). */
  readonly outputMm: { readonly width: number; readonly height: number } | null;
  readonly targetPxPerMm: number;
  readonly pixelBudget: number;
  readonly previewMaxEdge?: number;
};

/** Target trace density for a machine, in pixels per millimetre. */
export function traceTargetPxPerMm(
  device: Pick<DeviceProfile, 'laserSubProfile'> | undefined,
  machineKind: 'laser' | 'cnc' | undefined,
): number {
  const spot = machineKind === 'cnc' ? undefined : device?.laserSubProfile?.spotSizeMm;
  // The finer axis sets the density; an axis without a usable value is skipped.
  const axes = spot === undefined ? [] : [spot.x, spot.y].filter(isPositiveFinite);
  const spotMm = axes.length === 0 ? DEFAULT_TRACE_SPOT_MM : Math.min(...axes);
  return TRACE_SAMPLES_PER_SPOT / spotMm;
}

/** Working-pixel budget for one trace of these options on this device. It
 *  follows navigator.deviceMemory, so the committed geometry can differ between
 *  devices that report different memory (ADR-401). */
export function traceCommitPixelBudget(
  options: Pick<TraceOptions, 'traceMode'>,
  deviceMemoryGb: number | undefined,
): number {
  const memoryGb =
    deviceMemoryGb !== undefined && Number.isFinite(deviceMemoryGb) && deviceMemoryGb > 0
      ? deviceMemoryGb
      : DEFAULT_DEVICE_MEMORY_GB;
  const bytesPerPixel = TRACE_PEAK_BYTES_PER_PIXEL[traceLane(options)];
  const pixels = Math.floor((memoryGb * 2 ** 30 * TRACE_MEMORY_SHARE) / bytesPerPixel);
  const ceiling =
    traceLane(options) === 'centerline'
      ? TRACE_CENTERLINE_MAX_WORKING_PIXELS
      : TRACE_MAX_WORKING_PIXELS;
  return Math.min(ceiling, pixels);
}

/** The grid context for tracing `source` placed in `project` on this device. */
export function traceCommitGridContext(
  source: Pick<RasterImage, 'bounds' | 'transform'>,
  project: {
    readonly device?: Pick<DeviceProfile, 'laserSubProfile'>;
    readonly machine?: { readonly kind: 'laser' | 'cnc' } | undefined;
  },
  deviceMemoryGb: number | undefined,
): TraceCommitGridContext {
  return {
    outputMm: rasterOutputMm(source),
    targetPxPerMm: traceTargetPxPerMm(project.device, project.machine?.kind),
    deviceMemoryGb,
  };
}

/** Output size of a placed raster, in millimetres, or null when not finite. */
export function rasterOutputMm(
  source: Pick<RasterImage, 'bounds' | 'transform'>,
): { readonly width: number; readonly height: number } | null {
  const width = Math.abs((source.bounds.maxX - source.bounds.minX) * source.transform.scaleX);
  const height = Math.abs((source.bounds.maxY - source.bounds.minY) * source.transform.scaleY);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

/**
 * Choose the commit grid: min(native, output x target density), bounded by the
 * pixel budget, and never below the preview grid. The decode keeps the source
 * aspect ratio, so the axis that needs the most pixels sets the scale.
 */
export function planTraceCommitGrid(input: TraceCommitGridInput): TraceCommitGridPlan {
  const native = input.native;
  const previewMaxEdge = input.previewMaxEdge ?? PREVIEW_MAX_EDGE_PX;
  const preview = scaleToCap(native.width, native.height, previewMaxEdge);
  const nativeEdge = Math.max(native.width, native.height);
  const previewEdge = Math.max(preview.width, preview.height);
  const outputScale = outputScaleFor(input);
  const memoryScale = memoryScaleFor(native, input.pixelBudget);
  const scale = Math.min(1, outputScale, memoryScale);
  let limit: TraceCommitGridLimit = 'native';
  if (scale < 1) limit = memoryScale <= outputScale ? 'memory' : 'output';
  let maxEdge = scale >= 1 ? nativeEdge : Math.floor(nativeEdge * scale);
  // Rounding the short side can add a sliver of pixels; step down until the
  // decoded grid is inside the budget.
  while (maxEdge > previewEdge && gridPixels(native, maxEdge) > input.pixelBudget) maxEdge -= 1;
  if (maxEdge <= previewEdge) {
    return { grid: preview, maxEdge: previewEdge, preview, native, limit: 'preview' };
  }
  return {
    grid: scaleToCap(native.width, native.height, maxEdge),
    maxEdge,
    preview,
    native,
    limit,
  };
}

/** The plan for tracing a source with these options, or null for Photo
 *  shading, which samples a bounded band grid of its own and so keeps the
 *  preview's grid: a finer decode would change only the cost. */
export function planTraceCommitGridFor(
  native: ImageDimensions,
  context: TraceCommitGridContext,
  options: TraceOptions,
): TraceCommitGridPlan | null {
  if (options.photoDetail !== undefined) return null;
  return planTraceCommitGrid({
    native,
    outputMm: context.outputMm,
    targetPxPerMm: context.targetPxPerMm,
    pixelBudget: traceCommitPixelBudget(options, context.deviceMemoryGb),
  });
}

/** Whether the commit must decode and trace a grid finer than the preview's. */
export function commitGridExceedsPreview(plan: TraceCommitGridPlan): boolean {
  return plan.grid.width > plan.preview.width || plan.grid.height > plan.preview.height;
}

/**
 * The size controls an operator sets in the dialog (Ignore less than, ink
 * despeckle, Minimum line, gap joins) keep the physical meaning they had on
 * the preview grid, so the commit drops the same specks the preview dropped.
 * Lengths scale by the longest-edge ratio and areas by the ratio of the two
 * grids' pixel counts: on a tall or narrow source the short edge is a small
 * rounded integer, so a single-axis ratio would be off. Curve-fitting
 * tolerances are NOT scaled: they stay one working pixel, which is the
 * fidelity the finer grid exists to deliver.
 */
export function traceOptionsForCommitGrid(
  options: TraceOptions,
  plan: Pick<TraceCommitGridPlan, 'grid' | 'preview'>,
): TraceOptions {
  const { grid, preview } = plan;
  const ratio = Math.max(grid.width, grid.height) / Math.max(1, preview.width, preview.height);
  const area = (grid.width * grid.height) / Math.max(1, preview.width * preview.height);
  if (!Number.isFinite(ratio) || !Number.isFinite(area) || ratio <= 1) return options;
  return {
    ...options,
    ...scaled('despeckleMinPixels', options.despeckleMinPixels, area),
    ...scaled('ignoreLessThanPixels', options.ignoreLessThanPixels, area),
    ...scaled('edgeMinLengthPx', options.edgeMinLengthPx, ratio),
    ...scaled('edgeJoinGapPx', options.edgeJoinGapPx, ratio),
    ...scaled('centerlineJoinGapPx', options.centerlineJoinGapPx, ratio),
  };
}

/** Plain copy for the dialog: null when the commit traces the preview grid. */
export function describeTraceCommitGrid(plan: TraceCommitGridPlan): string | null {
  if (!commitGridExceedsPreview(plan)) return null;
  const preview = `${plan.preview.width} x ${plan.preview.height}`;
  const commit = `${plan.grid.width} x ${plan.grid.height} px`;
  const reason =
    plan.limit === 'native'
      ? 'the full image'
      : plan.limit === 'output'
        ? 'enough for the placed size on this machine'
        : `the most this trace style may use on this device; the image is ${plan.native.width} x ${plan.native.height} px`;
  return `Preview: ${preview} px. The committed trace uses ${commit} (${reason}), so it can keep detail the preview cannot show, and takes longer to trace.`;
}

function traceLane(
  options: Pick<TraceOptions, 'traceMode'>,
): keyof typeof TRACE_PEAK_BYTES_PER_PIXEL {
  if (options.traceMode === 'edge') return 'edge';
  if (options.traceMode === 'centerline') return 'centerline';
  return 'contour';
}

function outputScaleFor(input: TraceCommitGridInput): number {
  const { outputMm, targetPxPerMm, native } = input;
  if (outputMm === null || !Number.isFinite(targetPxPerMm) || targetPxPerMm <= 0) return 1;
  const scale = Math.max(
    (outputMm.width * targetPxPerMm) / native.width,
    (outputMm.height * targetPxPerMm) / native.height,
  );
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function memoryScaleFor(native: ImageDimensions, pixelBudget: number): number {
  const pixels = native.width * native.height;
  if (!Number.isFinite(pixelBudget) || pixelBudget <= 0) return 0;
  return Math.sqrt(pixelBudget / pixels);
}

function gridPixels(native: ImageDimensions, maxEdge: number): number {
  const grid = scaleToCap(native.width, native.height, maxEdge);
  return grid.width * grid.height;
}

function scaled<K extends keyof TraceOptions>(
  key: K,
  value: number | undefined,
  factor: number,
): Partial<TraceOptions> {
  return value === undefined || !Number.isFinite(value) ? {} : { [key]: value * factor };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
