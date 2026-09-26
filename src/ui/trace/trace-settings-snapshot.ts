// ADR-400: the Trace dialog's choices travel with the committed trace so
// Re-trace Original reopens the dialog exactly as the operator left it.
// `captureTraceSettings` records the dialog state at commit;
// `restoreTraceSettings` turns a recorded (possibly older, newer or hand-edited)
// snapshot back into dialog state, keeping only what this build can honour.

import type { TraceSettingsRecord, TraceSettingsValue } from '../../core/scene';
import { normalizeTraceBoundary, TRACE_PRESETS, type TraceBoundary } from '../../core/trace';
import { VISIBLE_TRACE_PRESET_NAMES, type TraceFillStyle, type TraceOutput } from './dialog-parts';
import type { BoundaryMode } from './region-enhance-trace';
import type { LightBurnTraceSettingOverrides, TraceDetectionMode } from './trace-options';
import {
  MAX_COLOUR_LAYERS,
  MIN_COLOUR_LAYERS,
  type ColourLayerOutput,
} from '../../core/trace/colour-layer-options';

export type TraceDialogSettings = {
  readonly presetName: string;
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly output: TraceOutput;
  readonly fillStyle: TraceFillStyle;
  readonly boundary: TraceBoundary | null;
  readonly boundaryMode: BoundaryMode;
};

export type RestoredTraceSettings = Partial<TraceDialogSettings>;

type OverrideRule =
  | { readonly kind: 'number'; readonly min: number; readonly max: number }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'detection' }
  // Colour layers' Colours control: 'auto' or a whole count in range (ADR-402).
  | { readonly kind: 'count-or-auto'; readonly min: number; readonly max: number }
  | { readonly kind: 'choice'; readonly values: ReadonlyArray<string> };

const BOOLEAN = { kind: 'boolean' } as const;

function range(min: number, max: number): OverrideRule {
  return { kind: 'number', min, max };
}

// The line presets' Invert control (`invert`, ADR-396) is an ordinary
// override key now that both branches are merged; the `satisfies` check below
// keeps every key's persistence decided.
type PersistedOverrideKey = keyof LightBurnTraceSettingOverrides;

// Exhaustive by construction, like the rules below.
const COLOUR_LAYER_OUTPUTS: ReadonlyArray<string> = Object.keys({
  'cut-out': true,
  stacked: true,
} satisfies Record<ColourLayerOutput, true>);

/**
 * How each dialog control persists: its value type and, for numbers, the range
 * the dialog's control offers (TraceSettingsControls.tsx,
 * PhotoTraceSettingsControls.tsx). Exhaustive by construction: adding an
 * override control without deciding how it persists is a type error here
 * rather than a silently dropped setting. A drift test checks the ranges
 * against the rendered controls.
 */
export const TRACE_OVERRIDE_RULES = {
  photoDetail: range(0, 100),
  photoBrightness: range(-100, 100),
  photoContrast: range(-100, 100),
  photoGamma: range(0.1, 5),
  photoInvert: BOOLEAN,
  invert: BOOLEAN,
  detectionMode: { kind: 'detection' },
  cutoffLuma: range(0, 255),
  thresholdLuma: range(0, 255),
  ignoreLessThanPixels: range(0, 10000),
  despeckleMinPixels: range(0, 10000),
  fillPinholeCracks: BOOLEAN,
  smoothness: range(0, 1.33),
  optimize: range(0, 2),
  traceTransparency: BOOLEAN,
  sketchTrace: BOOLEAN,
  edgeSensitivity: range(0, 100),
  edgeDetail: range(0, 100),
  edgeMinimumLinePx: range(0, 1000),
  colourCount: { kind: 'count-or-auto', min: MIN_COLOUR_LAYERS, max: MAX_COLOUR_LAYERS },
  colourLayerOutput: { kind: 'choice', values: COLOUR_LAYER_OUTPUTS },
  keepBackground: BOOLEAN,
} as const satisfies Record<PersistedOverrideKey, OverrideRule>;

// Exhaustive by construction, like the rules above.
const DETECTION_MODES: ReadonlyArray<string> = Object.keys({
  preset: true,
  manual: true,
  sketch: true,
  'faint-lines': true,
} satisfies Record<TraceDetectionMode, true>);

export function captureTraceSettings(settings: TraceDialogSettings): TraceSettingsRecord {
  const boundary = settings.boundary;
  return {
    schemaVersion: 1,
    presetName: settings.presetName,
    overrides: sanitizeOverrides(settings.overrides),
    output: settings.output,
    fillStyle: settings.fillStyle,
    ...(boundary === null
      ? {}
      : {
          boundary: {
            x: boundary.x,
            y: boundary.y,
            width: boundary.width,
            height: boundary.height,
          },
          boundaryMode: settings.boundaryMode,
        }),
  };
}

export function restoreTraceSettings(
  record: TraceSettingsRecord | undefined,
  sourceGrid: { readonly width: number; readonly height: number },
): RestoredTraceSettings {
  if (record === undefined) return {};
  const presetName = knownPresetName(record.presetName);
  const boundary = normalizeTraceBoundary(record.boundary, sourceGrid.width, sourceGrid.height);
  // Enhance replaces whole contours; photo ribbons and colour regions need Crop.
  const preset = TRACE_PRESETS[presetName ?? ''];
  const cropOnly = preset?.photoDetail !== undefined || preset?.colourLayers !== undefined;
  const boundaryMode: BoundaryMode = cropOnly ? 'crop' : (record.boundaryMode ?? 'crop');
  return {
    ...(presetName === undefined ? {} : { presetName }),
    // sanitizeOverrides keeps only entries whose value fits the control.
    overrides: sanitizeOverrides(record.overrides) as LightBurnTraceSettingOverrides,
    ...(record.output === undefined ? {} : { output: record.output }),
    ...(record.fillStyle === undefined ? {} : { fillStyle: record.fillStyle }),
    ...(boundary === null ? {} : { boundary, boundaryMode }),
  };
}

function knownPresetName(name: string): string | undefined {
  const visible = (VISIBLE_TRACE_PRESET_NAMES as ReadonlyArray<string>).includes(name);
  return visible && TRACE_PRESETS[name] !== undefined ? name : undefined;
}

// Keep only known controls whose value has the control's type, with numbers
// fitted to the range the control offers; anything else (a newer build's
// control, a hand edit) is ignored rather than guessed at.
function sanitizeOverrides(
  overrides: Readonly<Record<string, TraceSettingsValue | undefined>>,
): Record<string, TraceSettingsValue> {
  const out: Record<string, TraceSettingsValue> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(TRACE_OVERRIDE_RULES, key) || value === undefined) continue;
    const rule: OverrideRule = TRACE_OVERRIDE_RULES[key as PersistedOverrideKey];
    const accepted = acceptOverride(rule, value);
    if (accepted !== undefined) out[key] = accepted;
  }
  return out;
}

function acceptOverride(
  rule: OverrideRule,
  value: TraceSettingsValue,
): TraceSettingsValue | undefined {
  switch (rule.kind) {
    case 'number':
      return fitted(value, rule.min, rule.max);
    case 'count-or-auto':
      return value === 'auto' ? value : fitted(value, rule.min, rule.max, Math.round);
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'choice':
      return oneOf(value, rule.values);
    case 'detection':
      return oneOf(value, DETECTION_MODES);
  }
}

function fitted(
  value: TraceSettingsValue,
  min: number,
  max: number,
  snap: (n: number) => number = (n) => n,
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, snap(value)));
}

function oneOf(value: TraceSettingsValue, values: ReadonlyArray<string>): string | undefined {
  return typeof value === 'string' && values.includes(value) ? value : undefined;
}
