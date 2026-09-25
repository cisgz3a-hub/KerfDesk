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

export type TraceDialogSettings = {
  readonly presetName: string;
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly output: TraceOutput;
  readonly fillStyle: TraceFillStyle;
  readonly boundary: TraceBoundary | null;
  readonly boundaryMode: BoundaryMode;
};

export type RestoredTraceSettings = Partial<TraceDialogSettings>;

type OverrideKind = 'number' | 'boolean' | 'detection';

// Exhaustive by construction: adding an override control without deciding how
// it persists is a type error here rather than a silently dropped setting.
const OVERRIDE_KINDS = {
  photoDetail: 'number',
  photoBrightness: 'number',
  photoContrast: 'number',
  photoGamma: 'number',
  photoInvert: 'boolean',
  detectionMode: 'detection',
  cutoffLuma: 'number',
  thresholdLuma: 'number',
  ignoreLessThanPixels: 'number',
  despeckleMinPixels: 'number',
  fillPinholeCracks: 'boolean',
  smoothness: 'number',
  optimize: 'number',
  traceTransparency: 'boolean',
  sketchTrace: 'boolean',
  edgeSensitivity: 'number',
  edgeDetail: 'number',
  edgeMinimumLinePx: 'number',
} as const satisfies Record<keyof LightBurnTraceSettingOverrides, OverrideKind>;

const DETECTION_MODES: ReadonlyArray<TraceDetectionMode> = [
  'preset',
  'manual',
  'sketch',
  'faint-lines',
];

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
  // Enhance replaces whole contours; photo ribbons need Crop.
  const photo = TRACE_PRESETS[presetName ?? '']?.photoDetail !== undefined;
  const boundaryMode: BoundaryMode = photo ? 'crop' : (record.boundaryMode ?? 'crop');
  return {
    ...(presetName === undefined ? {} : { presetName }),
    // sanitizeOverrides keeps only entries whose value matches the control's type.
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

// Keep only known controls whose value has the control's type; anything else
// (a newer build's control, a hand edit) is ignored rather than guessed at.
function sanitizeOverrides(
  overrides: Readonly<Record<string, TraceSettingsValue | undefined>>,
): Record<string, TraceSettingsValue> {
  const out: Record<string, TraceSettingsValue> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(OVERRIDE_KINDS, key) || value === undefined) continue;
    const kind: OverrideKind = OVERRIDE_KINDS[key as keyof typeof OVERRIDE_KINDS];
    if (overrideValueMatches(kind, value)) out[key] = value;
  }
  return out;
}

function overrideValueMatches(kind: OverrideKind, value: TraceSettingsValue): boolean {
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (kind === 'boolean') return typeof value === 'boolean';
  return (DETECTION_MODES as ReadonlyArray<unknown>).includes(value);
}
