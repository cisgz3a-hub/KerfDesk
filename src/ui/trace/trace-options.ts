// Pure-data helpers for assembling and re-shaping TraceOptions in the
// import dialog. Extracted from ImportImageDialog.tsx so each is
// testable without a React renderer and the dialog file stays nearer
// the 250-line soft cap.
//
// The Trace Image workflow owns vector-trace controls only:
// cutoff, threshold, invert, ignore-small-shapes, smoothness, and optimize.
// Image-level tone edits stay in Adjust Image.

import type { TraceOptions } from '../../core/trace';
import {
  EDGE_CONTRAST_DELTA_MAX,
  edgeBlurSigmaForRadius,
  edgeContrastDelta,
  edgeLowThresholdRatioForDelta,
  edgeSourceRadiusPx,
} from '../../core/trace/edge-input';
import {
  mergeColourLayerSettings,
  type ColourLayerSettingOverrides,
} from './colour-layer-settings';

export type LightBurnTraceSettingOverrides = ColourLayerSettingOverrides & {
  readonly photoDetail?: number;
  readonly photoBrightness?: number;
  readonly photoContrast?: number;
  readonly photoGamma?: number;
  readonly photoInvert?: boolean;
  // Line presets' Invert. Kept apart from photoInvert: each style keeps its
  // own choice, so switching presets never inverts a trace unasked.
  readonly invert?: boolean;
  readonly detectionMode?: TraceDetectionMode;
  readonly cutoffLuma?: number;
  readonly thresholdLuma?: number;
  readonly ignoreLessThanPixels?: number;
  readonly despeckleMinPixels?: number;
  readonly fillPinholeCracks?: boolean;
  readonly smoothness?: number;
  readonly optimize?: number;
  readonly traceTransparency?: boolean;
  readonly sketchTrace?: boolean;
  readonly edgeSensitivity?: number;
  readonly edgeDetail?: number;
  readonly edgeMinimumLinePx?: number;
};

export type TraceDetectionMode = 'preset' | 'manual' | 'sketch' | 'faint-lines';

export const DEFAULT_EDGE_MINIMUM_LINE_PX = 3;

export function mergeLightBurnTraceSettings(
  preset: TraceOptions,
  settings: LightBurnTraceSettingOverrides,
): TraceOptions {
  if (preset.photoDetail !== undefined) return mergePhotoSettings(preset, settings);
  if (preset.colourLayers !== undefined) return mergeColourLayerSettings(preset, settings);
  const out: Record<string, unknown> = { ...preset };
  applyDetectionSettings(out, preset, settings);
  if (settings.ignoreLessThanPixels !== undefined) {
    out['ignoreLessThanPixels'] = Math.max(0, Math.round(settings.ignoreLessThanPixels));
  }
  if (settings.despeckleMinPixels !== undefined) {
    out['despeckleMinPixels'] = Math.max(0, Math.round(settings.despeckleMinPixels));
  }
  if (settings.fillPinholeCracks !== undefined && preset.traceMode !== 'edge') {
    out['fillPinholeCracks'] = settings.fillPinholeCracks;
  }
  if (settings.smoothness !== undefined) out['smoothness'] = clampMin(settings.smoothness, 0);
  if (settings.optimize !== undefined) out['optimize'] = clampMin(settings.optimize, 0);
  if (settings.traceTransparency !== undefined) {
    out['traceTransparency'] = settings.traceTransparency;
  }
  if (settings.invert !== undefined) out['invert'] = settings.invert;
  if (preset.traceMode === 'edge') {
    applyEdgeTraceSettings(out, preset, settings);
  }
  return out as TraceOptions;
}

function mergePhotoSettings(
  preset: TraceOptions,
  settings: LightBurnTraceSettingOverrides,
): TraceOptions {
  // Keep the operator's other style settings in UI state without allowing a
  // stale threshold, alpha mask or speckle filter to destroy photo midtones.
  // Photo tone controls have their own keys, so they never reach line presets.
  return {
    ...preset,
    photoDetail: photoValue(settings.photoDetail, preset.photoDetail ?? 60, 0, 100),
    brightness: photoValue(settings.photoBrightness, preset.brightness ?? 0, -100, 100),
    contrast: photoValue(settings.photoContrast, preset.contrast ?? 0, -100, 100),
    gamma: photoValue(settings.photoGamma, preset.gamma ?? 1, 0.1, 5),
    invert: settings.photoInvert ?? preset.invert ?? false,
  };
}

function photoValue(value: number | undefined, fallback: number, min: number, max: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : clamp(value, min, max);
}

export function traceDetectionMode(
  preset: TraceOptions,
  settings: LightBurnTraceSettingOverrides,
): TraceDetectionMode {
  if (settings.detectionMode !== undefined) return settings.detectionMode;
  if (preset.faintLineRecovery === true) return 'faint-lines';
  if ((settings.sketchTrace ?? preset.sketchTrace) === true) return 'sketch';
  return settings.cutoffLuma !== undefined || settings.thresholdLuma !== undefined
    ? 'manual'
    : 'preset';
}

function applyDetectionSettings(
  out: Record<string, unknown>,
  preset: TraceOptions,
  settings: LightBurnTraceSettingOverrides,
): void {
  // Returning to preset detection restores its complete detection policy while
  // retaining the operator's manual band for a later deliberate switch back.
  if (settings.detectionMode === 'preset') return;
  if (settings.detectionMode === 'faint-lines') {
    if (preset.traceMode === 'edge') return;
    out['faintLineRecovery'] = true;
    out['sketchTrace'] = false;
    // The faint flag already takes precedence over automatic sketch masking.
    // Retain the preset's color workload policy if alpha owns detection.
    return;
  }
  if (settings.detectionMode === 'sketch') {
    delete out['faintLineRecovery'];
    out['sketchTrace'] = true;
    return;
  }
  if (settings.detectionMode === 'manual') {
    applyManualDetection(out, preset, settings);
    return;
  }
  // Preserve the existing programmatic override contract. The dialog uses an
  // explicit mode so automatic settings never masquerade as a manual band.
  const manualThreshold = settings.cutoffLuma !== undefined || settings.thresholdLuma !== undefined;
  if (manualThreshold) {
    delete out['faintLineRecovery'];
    delete out['useOtsuThreshold'];
    out['autoSketchTrace'] = false;
  }
  if (settings.cutoffLuma !== undefined) out['cutoffLuma'] = clampByte(settings.cutoffLuma);
  if (settings.thresholdLuma !== undefined) {
    out['thresholdLuma'] = clampByte(settings.thresholdLuma);
  }
  if (settings.sketchTrace !== undefined) {
    out['sketchTrace'] = settings.sketchTrace;
  }
}

function applyManualDetection(
  out: Record<string, unknown>,
  preset: TraceOptions,
  settings: LightBurnTraceSettingOverrides,
): void {
  delete out['faintLineRecovery'];
  delete out['useOtsuThreshold'];
  out['autoSketchTrace'] = false;
  out['sketchTrace'] = false;
  out['cutoffLuma'] = clampByte(settings.cutoffLuma ?? preset.cutoffLuma ?? 0);
  out['thresholdLuma'] = clampByte(settings.thresholdLuma ?? preset.thresholdLuma ?? 128);
}

// Sensitivity and Detail offer one stop per detector setting (ADR-412):
// Sensitivity moves in steps of 10 over 11 contrast deltas (0 -> 12 luma
// levels, 100 -> 2); Detail in steps of 5 over 21 neighbourhood radii
// (0 -> 24 source px, 100 -> 4). A value between stops takes the nearest one.
export const EDGE_SENSITIVITY_STEP = 10;
export const EDGE_DETAIL_STEP = 5;
const EDGE_DETAIL_RADIUS_AT_ZERO_PX = 24;

export function edgeSensitivityFromOptions(options: TraceOptions): number {
  return (EDGE_CONTRAST_DELTA_MAX - edgeContrastDelta(options)) * EDGE_SENSITIVITY_STEP;
}

export function edgeDetailFromOptions(options: TraceOptions): number {
  const stops = EDGE_DETAIL_RADIUS_AT_ZERO_PX - edgeSourceRadiusPx(options);
  return clamp(stops * EDGE_DETAIL_STEP, 0, 100);
}

function edgeDeltaForSensitivity(sensitivity: number): number {
  return EDGE_CONTRAST_DELTA_MAX - Math.round(clamp(sensitivity, 0, 100) / EDGE_SENSITIVITY_STEP);
}

function edgeRadiusForDetail(detail: number): number {
  return EDGE_DETAIL_RADIUS_AT_ZERO_PX - Math.round(clamp(detail, 0, 100) / EDGE_DETAIL_STEP);
}

// `out` already holds the preset's fields. A stop that lands on the preset's
// own detector setting keeps the preset value untouched.
function applyEdgeTraceSettings(
  out: Record<string, unknown>,
  preset: TraceOptions,
  settings: LightBurnTraceSettingOverrides,
): void {
  if (settings.edgeSensitivity !== undefined) {
    const delta = edgeDeltaForSensitivity(settings.edgeSensitivity);
    if (delta !== edgeContrastDelta(preset)) {
      out['edgeLowThresholdRatio'] = edgeLowThresholdRatioForDelta(delta);
    }
  }
  if (settings.edgeDetail !== undefined) {
    const radius = edgeRadiusForDetail(settings.edgeDetail);
    if (radius !== edgeSourceRadiusPx(preset))
      out['edgeBlurSigma'] = edgeBlurSigmaForRadius(radius);
  }
  if (settings.edgeMinimumLinePx !== undefined) {
    out['edgeMinLengthPx'] = Math.max(0, settings.edgeMinimumLinePx);
  } else {
    out['edgeMinLengthPx'] = preset.edgeMinLengthPx ?? DEFAULT_EDGE_MINIMUM_LINE_PX;
  }
}

// True when the options stack any of the preset features that can
// collapse a near-uniform image to zero paths: Otsu histogram
// binarization, fixedPalette, despeckle, or the automatic small-mark
// cleanup (ADR-409), which can erase art made only of small marks.
export function hasAggressivePreprocessing(options: TraceOptions): boolean {
  if (options.photoDetail !== undefined) return false;
  // Edge's local-contrast detector reads none of these (older saved options
  // may still carry them), so relaxing them cannot change its output — a
  // zero-paths retry would just repeat the identical multi-second pipeline.
  if (options.traceMode === 'edge') return false;
  // Colour layers (ADR-402) own their speck rule: a missing despeckle reads as
  // the same 12 px default, so a "relaxed" retry would repeat the identical
  // colour pipeline and falsely report relaxed settings.
  if (options.colourLayers !== undefined) return false;
  return (
    options.useOtsuThreshold === true ||
    options.fixedPalette !== undefined ||
    (options.despeckleMinPixels !== undefined && options.despeckleMinPixels > 1) ||
    options.smallMarkPolicy === 'auto'
  );
}

// Strip the aggressive levers without disturbing the user's other
// trace choices. Returns a fresh object and never mutates the caller.
//
// fixedPalette is intentionally KEPT (M10, AUDIT-2026-06-10): deleting it
// switched a two-color preset's zero-paths retry off the binary contour
// backend into imagetracerjs with no palette — whose adaptive quantizer collapses
// to black/black on binary input (samplepalette2 mid-row seeds +
// colorquantcycles:1 disabling every recovery), committing a full-frame
// rectangle instead of an honest "no paths". The retry must stay on the
// same backend; only Otsu, despeckle, and pathOmit relax.
//
// smallMarkPolicy goes with despeckle (ADR-409): an unset despeckle means
// "automatic" while the policy is on, so deleting despeckle alone would
// re-run the same automatic cleanup (or turn an explicit value back into
// auto) instead of relaxing it. Without the policy the retry erases no ink
// specks and fills no pinholes the user did not ask for explicitly.
export function relaxAggressivePreprocessing(options: TraceOptions): TraceOptions {
  const next: Record<string, unknown> = { ...options };
  delete next['useOtsuThreshold'];
  delete next['despeckleMinPixels'];
  delete next['smallMarkPolicy'];
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
