// Pure-data helpers for assembling and re-shaping TraceOptions in the
// import dialog. Extracted from ImportImageDialog.tsx so each is
// testable without a React renderer and the dialog file stays nearer
// the 250-line soft cap.
//
// Three operations:
//   1. mergeAdjustments — layer user slider/checkbox values on top of
//      a preset; neutral values fall through untouched so a reset
//      reproduces the preset's behaviour.
//   2. hasAggressivePreprocessing — predicate for whether the options
//      stack any of the three levers (Otsu / fixedPalette / despeckle)
//      that can collapse a low-contrast image to zero paths.
//   3. relaxAggressivePreprocessing — strip those three levers without
//      disturbing anything else; used as a retry shape when the first
//      trace returns no paths.
//
// All three are pure functions over plain data — no React, no I/O.

import type { TraceOptions } from '../../core/trace';
import type { AdjustmentValues } from './AdjustmentControls';

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

// Apply user adjustments on top of a preset. Each adjustment is only
// included if it's not at its neutral value (0 / 0 / 1 / false /
// 'none'), so a clean reset produces the same options object the
// preset gave us — preserving preset semantics like "Line Art uses
// Otsu" when the user hasn't touched a slider.
export function mergeAdjustments(preset: TraceOptions, adj: AdjustmentValues): TraceOptions {
  // TypeScript exactOptionalPropertyTypes — setting a field to
  // undefined isn't the same as omitting it. We conditionally add via
  // a loose Record, then cast at the boundary.
  const out: Record<string, unknown> = { ...preset };
  if (adj.brightness !== 0) out['brightness'] = adj.brightness;
  if (adj.contrast !== 0) out['contrast'] = adj.contrast;
  if (adj.gamma !== 1) out['gamma'] = adj.gamma;
  if (adj.invert) out['invert'] = true;
  if (adj.ditherMode !== 'none') out['ditherMode'] = adj.ditherMode;
  return out as TraceOptions;
}

// True when the options stack any of the three preset features that
// CAN collapse a near-uniform image to zero paths: Otsu (histogram-
// based binarisation), fixedPalette (forces 2-colour), or despeckle
// (drops small ink regions). When all three are off, a zero-paths
// result reflects the user's input genuinely lacking contrast, not a
// preset over-reach — so callers don't retry.
export function hasAggressivePreprocessing(options: TraceOptions): boolean {
  return (
    options.useOtsuThreshold === true ||
    options.fixedPalette !== undefined ||
    (options.despeckleMinPixels !== undefined && options.despeckleMinPixels > 1)
  );
}

// Strip the aggressive levers without disturbing the user's image
// adjustments. Returns a fresh object — does not mutate the caller's
// options. Removed / overridden fields:
//
//   - useOtsuThreshold: removed (histogram-based cutoff can pick a
//     degenerate value on low-contrast inputs).
//   - fixedPalette: removed (lets imagetracerjs auto-quantize to 2
//     colours instead of forcing a hand-picked palette).
//   - despeckleMinPixels: removed (skips the connected-component
//     erase that can eat small but valid shapes).
//   - pathOmit: forced to 0 (was 16 on Line Art / Smooth / Sharp).
//     pathOmit is imagetracerjs's "minimum point count per path"
//     filter — at 16 it drops shapes whose boundary traces to fewer
//     than 16 points, which on a small logo or text glyph is most of
//     them. The first pass already tried filtering; the retry should
//     keep everything imagetracerjs can find.
//
// Everything else (brightness / contrast / gamma / invert /
// ditherMode / lineFilter / blur / tolerances / numberOfColors) is
// preserved so the user's image-adjustment intent survives the retry.
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
