// Line + fill's Max stroke width (ADR-454): the operator sets millimetres on
// the placed artwork; the tracer wants preview-grid pixels (the commit grid
// then scales them like every other size control, traceOptionsForCommitGrid).

import type { DeviceProfile } from '../../core/devices';
import type { RasterImage } from '../../core/scene';
import type { TraceOptions } from '../../core/trace';
import { rasterOutputMm, TRACE_SAMPLES_PER_SPOT, traceTargetPxPerMm } from './trace-commit-grid';
import { PREVIEW_MAX_EDGE_PX, scaleToCap } from './trace-decode-cap';
import type { LightBurnTraceSettingOverrides } from './trace-options';

/** Ink up to this many burn spots wide still reads as one pass down its
 *  centre: a single pass widens a little with dwell and char, and a pen line
 *  of two or three spots looks the same burned once as outlined and filled. */
export const HYBRID_SPOTS_PER_STROKE = 3;
/** Floor for the default, so a very fine spot does not turn every
 *  scanned pen line into a filled outline. */
export const HYBRID_MIN_DEFAULT_STROKE_MM = 0.25;
export const HYBRID_MAX_STROKE_WIDTH_MM_RANGE = { min: 0.05, max: 10 } as const;

/** Default Max stroke width for this machine, in millimetres. */
export function defaultHybridMaxStrokeWidthMm(
  device: Pick<DeviceProfile, 'laserSubProfile'> | undefined,
  machineKind: 'laser' | 'cnc' | undefined,
): number {
  const spotMm = TRACE_SAMPLES_PER_SPOT / traceTargetPxPerMm(device, machineKind);
  const mm = Math.max(HYBRID_MIN_DEFAULT_STROKE_MM, HYBRID_SPOTS_PER_STROKE * spotMm);
  return Math.round(mm * 100) / 100;
}

/** The operator's Max stroke width, or the machine default. */
export function hybridMaxStrokeWidthMm(
  overrides: LightBurnTraceSettingOverrides,
  device: Pick<DeviceProfile, 'laserSubProfile'> | undefined,
  machineKind: 'laser' | 'cnc' | undefined,
): number {
  const value = overrides.hybridMaxStrokeWidthMm;
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : defaultHybridMaxStrokeWidthMm(device, machineKind);
}

/** Preview-grid pixels per placed millimetre, or null when the placement is
 *  unknown. The preview decodes the whole source to PREVIEW_MAX_EDGE_PX, so a
 *  region trace shares the whole image's density. */
export function previewPxPerMm(
  source: Pick<RasterImage, 'bounds' | 'transform' | 'pixelWidth' | 'pixelHeight'>,
  previewMaxEdge: number = PREVIEW_MAX_EDGE_PX,
): number | null {
  const output = rasterOutputMm(source);
  if (output === null || !(source.pixelWidth > 0) || !(source.pixelHeight > 0)) return null;
  const preview = scaleToCap(source.pixelWidth, source.pixelHeight, previewMaxEdge);
  const density = Math.max(preview.width / output.width, preview.height / output.height);
  return Number.isFinite(density) && density > 0 ? density : null;
}

/** Options with the millimetre gate converted to preview pixels; other trace
 *  modes, and an unknown placement (the core's 4 px default), pass through. */
export function withHybridMaxStrokeWidth(
  options: TraceOptions,
  widthMm: number,
  pxPerMm: number | null,
): TraceOptions {
  if (options.traceMode !== 'hybrid' || pxPerMm === null) return options;
  const px = widthMm * pxPerMm;
  if (!Number.isFinite(px) || px <= 0) return options;
  // No floor here: the commit grid scales this value up, and the core floors
  // the gate at 1 px on its own working grid.
  return { ...options, hybridMaxStrokeWidthPx: px };
}
