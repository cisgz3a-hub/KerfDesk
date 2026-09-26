// What the Trace dialog's overrides become when the operator picks another
// preset (ADR-434 Amendment 1).
//
// A preset's numbers are calibrated for its own pipeline, so an override of a
// setting the new preset defines is dropped and the new preset's value shows:
// Line Art's Auto small-mark cleanup must not silently become an exact 12 px
// when leaving Centerline, and a contour Smoothness must not become
// Centerline's corner angle. Everything else carries:
//   * settings the new preset leaves to the engine default (a Smoothness
//     tuned on Smooth still applies on Edge Detection, which sets none);
//   * detection choices (mode, manual band, sketch) and the alpha mask,
//     which describe the source rather than a preset's calibration;
//   * style-exclusive controls (Photo, Colour layers, Edge), which apply
//     only to their own style and so come back when the operator returns.

import type { TraceOptions } from '../../core/trace';
import type { LightBurnTraceSettingOverrides } from './trace-options';

type SharedKey =
  | 'smoothness'
  | 'optimize'
  | 'ignoreLessThanPixels'
  | 'despeckleMinPixels'
  | 'fillPinholeCracks'
  | 'invert';

const lineStyle = (p: TraceOptions): boolean =>
  p.photoDetail === undefined && p.colourLayers === undefined;
const colourLayers = (p: TraceOptions): boolean => p.colourLayers !== undefined;
const smallMarks = (p: TraceOptions): boolean => p.smallMarkPolicy === 'auto';
const autoOn = (p: TraceOptions, value: unknown): boolean => value === 'auto' && lineStyle(p);

/** Whether a preset sets its own value for a shared control. An 'auto'
 *  small-mark override is not a value but a switch that turns the automatic
 *  policy on, so every line preset defines the answer to it: a preset without
 *  the policy (Sharp) chose fixed cleanup, and one with it already has Auto. */
const DEFINED_BY: Readonly<Record<SharedKey, (preset: TraceOptions, value: unknown) => boolean>> = {
  smoothness: (p) => p.smoothness !== undefined,
  optimize: (p) => p.optimize !== undefined,
  ignoreLessThanPixels: (p) => p.ignoreLessThanPixels !== undefined,
  // Colour layers' "Remove specks" shares the key with its own meaning.
  despeckleMinPixels: (p, v) =>
    p.despeckleMinPixels !== undefined || smallMarks(p) || colourLayers(p) || autoOn(p, v),
  fillPinholeCracks: (p, v) => p.fillPinholeCracks !== undefined || smallMarks(p) || autoOn(p, v),
  // Photo shading's Invert is its own control (photoInvert).
  invert: (p) => lineStyle(p) && p.invert !== undefined,
};

// ADR-405: in Centerline, Smoothness and Optimize are the corner angle and
// the fit tolerance, so a value never carries across that boundary.
const ROLE_KEYS: ReadonlyArray<SharedKey> = ['smoothness', 'optimize'];
const centerline = (p: TraceOptions): boolean => p.traceMode === 'centerline';

export function overridesForPresetSwitch(
  overrides: LightBurnTraceSettingOverrides,
  from: TraceOptions | undefined,
  to: TraceOptions | undefined,
): LightBurnTraceSettingOverrides {
  if (to === undefined || from === to) return overrides;
  const roleChange = from !== undefined && centerline(from) !== centerline(to);
  const dropped = (Object.keys(DEFINED_BY) as SharedKey[]).filter(
    (key) =>
      overrides[key] !== undefined &&
      (DEFINED_BY[key](to, overrides[key]) || (roleChange && ROLE_KEYS.includes(key))),
  );
  if (dropped.length === 0) return overrides;
  const drop = new Set<string>(dropped);
  return Object.fromEntries(
    Object.entries(overrides).filter(([key]) => !drop.has(key)),
  ) as LightBurnTraceSettingOverrides;
}
