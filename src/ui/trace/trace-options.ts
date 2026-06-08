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
};

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
  return out as TraceOptions;
}

// True when the options stack any of the three preset features that
// can collapse a near-uniform image to zero paths: Otsu histogram
// binarization, fixedPalette, or despeckle.
export function hasAggressivePreprocessing(options: TraceOptions): boolean {
  return (
    options.useOtsuThreshold === true ||
    options.fixedPalette !== undefined ||
    (options.despeckleMinPixels !== undefined && options.despeckleMinPixels > 1)
  );
}

// Strip the aggressive levers without disturbing the user's other
// trace choices. Returns a fresh object and never mutates the caller.
export function relaxAggressivePreprocessing(options: TraceOptions): TraceOptions {
  const next: Record<string, unknown> = { ...options };
  delete next['useOtsuThreshold'];
  delete next['fixedPalette'];
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
