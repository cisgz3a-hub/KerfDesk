// Pure-data helpers for assembling and re-shaping TraceOptions in the
// import dialog. Extracted from ImportImageDialog.tsx so each is
// testable without a React renderer and the dialog file stays nearer
// the 250-line soft cap.
//
// The Trace Image workflow owns vector-trace controls only:
// cutoff, threshold, ignore-small-shapes, smoothness, and optimize.
// Image-level tone edits stay in Adjust Image.

import type { TraceOptions } from '../../core/trace';

export type LightBurnTraceSettingOverrides = {
  readonly cutoffLuma?: number;
  readonly thresholdLuma?: number;
  readonly ignoreLessThanPixels?: number;
  readonly smoothness?: number;
  readonly optimize?: number;
  readonly traceTransparency?: boolean;
  readonly sketchTrace?: boolean;
  readonly edgeSensitivity?: number;
  readonly edgeDetail?: number;
  readonly edgeMinimumLinePx?: number;
};

export const DEFAULT_EDGE_SENSITIVITY = 50;
export const DEFAULT_EDGE_DETAIL = 68;
export const DEFAULT_EDGE_MINIMUM_LINE_PX = 3;

export function mergeLightBurnTraceSettings(
  preset: TraceOptions,
  settings: LightBurnTraceSettingOverrides,
): TraceOptions {
  const out: Record<string, unknown> = { ...preset };
  const manualThreshold = settings.cutoffLuma !== undefined || settings.thresholdLuma !== undefined;
  if (manualThreshold) delete out['useOtsuThreshold'];
  if (settings.cutoffLuma !== undefined) out['cutoffLuma'] = clampByte(settings.cutoffLuma);
  if (settings.thresholdLuma !== undefined) {
    out['thresholdLuma'] = clampByte(settings.thresholdLuma);
  }
  if (settings.ignoreLessThanPixels !== undefined) {
    const pixels = Math.max(0, Math.round(settings.ignoreLessThanPixels));
    out['ignoreLessThanPixels'] = pixels;
    out['despeckleMinPixels'] = pixels;
  }
  if (settings.smoothness !== undefined) out['smoothness'] = clampMin(settings.smoothness, 0);
  if (settings.optimize !== undefined) out['optimize'] = clampMin(settings.optimize, 0);
  if (settings.traceTransparency !== undefined) {
    out['traceTransparency'] = settings.traceTransparency;
  }
  if (settings.sketchTrace !== undefined) {
    out['sketchTrace'] = settings.sketchTrace;
  }
  if (preset.traceMode === 'edge') {
    applyEdgeTraceSettings(out, preset, settings);
  }
  return out as TraceOptions;
}

export function edgeSensitivityFromOptions(options: TraceOptions): number {
  const high = options.edgeHighThresholdRatio ?? 0.2;
  return clamp(Math.round(((0.32 - high) / (0.32 - 0.05)) * 100), 0, 100);
}

export function edgeDetailFromOptions(options: TraceOptions): number {
  const blur = options.edgeBlurSigma ?? 1.2;
  return clamp(Math.round(((2.5 - blur) / (2.5 - 0.6)) * 100), 0, 100);
}

function applyEdgeTraceSettings(
  out: Record<string, unknown>,
  preset: TraceOptions,
  settings: LightBurnTraceSettingOverrides,
): void {
  if (
    settings.edgeSensitivity !== undefined &&
    settings.edgeSensitivity !== edgeSensitivityFromOptions(preset)
  ) {
    const thresholds = edgeSensitivityToThresholds(settings.edgeSensitivity);
    out['edgeLowThresholdRatio'] = thresholds.low;
    out['edgeHighThresholdRatio'] = thresholds.high;
  } else {
    copyIfDefined(out, 'edgeLowThresholdRatio', preset.edgeLowThresholdRatio);
    copyIfDefined(out, 'edgeHighThresholdRatio', preset.edgeHighThresholdRatio);
  }
  if (settings.edgeDetail !== undefined && settings.edgeDetail !== edgeDetailFromOptions(preset)) {
    const detail = edgeDetailToCanny(settings.edgeDetail);
    out['edgeBlurSigma'] = detail.blurSigma;
    out['edgeJoinGapPx'] = detail.joinGapPx;
  } else {
    copyIfDefined(out, 'edgeBlurSigma', preset.edgeBlurSigma);
    copyIfDefined(out, 'edgeJoinGapPx', preset.edgeJoinGapPx);
  }
  if (settings.edgeMinimumLinePx !== undefined) {
    out['edgeMinLengthPx'] = Math.max(0, settings.edgeMinimumLinePx);
  } else {
    out['edgeMinLengthPx'] = preset.edgeMinLengthPx ?? DEFAULT_EDGE_MINIMUM_LINE_PX;
  }
}

function edgeSensitivityToThresholds(sensitivity: number): {
  readonly low: number;
  readonly high: number;
} {
  const t = clamp(sensitivity, 0, 100) / 100;
  const high = roundRatio(0.32 + (0.05 - 0.32) * t);
  return { low: roundRatio(high * 0.4), high };
}

// Join gap scales WITH blur: Canny's detection dropouts widen with the blur
// kernel, so heavier smoothing needs a proportionally longer bridge. The
// ratio is anchored so the preset default (blur 1.2, joinGap 5) round-trips
// exactly at the default Detail position — the old fixed [0.5, 2] range was
// calibrated for the deleted outline backend and collapsed the preset's
// join gap the moment Detail moved at all.
const EDGE_JOIN_GAP_PX_PER_BLUR_SIGMA = 5 / 1.2;

function edgeDetailToCanny(detail: number): {
  readonly blurSigma: number;
  readonly joinGapPx: number;
} {
  const t = clamp(detail, 0, 100) / 100;
  const blurSigma = roundRatio(2.5 + (0.6 - 2.5) * t);
  return {
    blurSigma,
    joinGapPx: roundRatio(blurSigma * EDGE_JOIN_GAP_PX_PER_BLUR_SIGMA),
  };
}

function copyIfDefined<T extends keyof TraceOptions>(
  out: Record<string, unknown>,
  key: T,
  value: TraceOptions[T],
): void {
  if (value !== undefined) out[key] = value;
}

// True when the options stack any of the three preset features that
// can collapse a near-uniform image to zero paths: Otsu histogram
// binarization, fixedPalette, or despeckle.
export function hasAggressivePreprocessing(options: TraceOptions): boolean {
  // Edge mode never runs the shared preprocessing (Canny reads the raw
  // image), so relaxing these flags cannot change its output — a zero-paths
  // retry would just repeat the identical multi-second pipeline.
  if (options.traceMode === 'edge') return false;
  return (
    options.useOtsuThreshold === true ||
    options.fixedPalette !== undefined ||
    (options.despeckleMinPixels !== undefined && options.despeckleMinPixels > 1)
  );
}

// Strip the aggressive levers without disturbing the user's other
// trace choices. Returns a fresh object and never mutates the caller.
//
// fixedPalette is intentionally KEPT (M10, AUDIT-2026-06-10): deleting it
// switched a two-color preset's zero-paths retry off the potrace backend
// into imagetracerjs with no palette — whose adaptive quantizer collapses
// to black/black on binary input (samplepalette2 mid-row seeds +
// colorquantcycles:1 disabling every recovery), committing a full-frame
// rectangle instead of an honest "no paths". The retry must stay on the
// same backend; only Otsu, despeckle, and pathOmit relax.
export function relaxAggressivePreprocessing(options: TraceOptions): TraceOptions {
  const next: Record<string, unknown> = { ...options };
  delete next['useOtsuThreshold'];
  delete next['despeckleMinPixels'];
  next['pathOmit'] = 0;
  return next as TraceOptions;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampMin(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function roundRatio(value: number): number {
  return Number(value.toFixed(4));
}
