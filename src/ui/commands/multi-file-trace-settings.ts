// Multi-File Trace's Settings choice (rank 20): the chosen preset's defaults,
// or the settings of the last Trace Image commit — the ADR-408 snapshot that
// Re-trace Original reopens — merged exactly as the Trace dialog merges them.

import type { SceneObject } from '../../core/scene';
import type { TraceSettingsRecord } from '../../core/scene/scene-object';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { mergeLightBurnTraceSettings } from '../trace/trace-options';
import { restoreTraceSettings } from '../trace/trace-settings-snapshot';

export type MultiFileTraceSettingsSource = 'preset' | 'last-trace';

export type BatchTraceSettings = {
  readonly options: TraceOptions | undefined;
  readonly presetName: string;
  /** Line + fill's recorded Max stroke width, converted per file (ADR-454). */
  readonly hybridMaxStrokeWidthMm?: number;
  /** Which settings the batch used, for its notice. */
  readonly label: string;
};

/** The newest trace in the scene that recorded its dialog settings. */
export function lastTraceSettingsRecord(
  objects: ReadonlyArray<SceneObject>,
): TraceSettingsRecord | null {
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const object = objects[i];
    if (object === undefined) continue;
    const nested = 'children' in object && Array.isArray(object.children) ? object.children : null;
    const found =
      'traceSettings' in object && object.traceSettings !== undefined
        ? object.traceSettings
        : nested === null
          ? null
          : lastTraceSettingsRecord(nested as ReadonlyArray<SceneObject>);
    if (found !== null) return found;
  }
  return null;
}

/**
 * The options every file in the batch is traced with. Preset defaults keep
 * today's batch exactly; Last Trace Image restores the snapshot as Re-trace
 * does and merges its overrides (turn policy included) into its preset. Its
 * crop boundary, fill style and raster output belong to that one image and
 * are not applied.
 */
export function batchTraceSettings(
  source: MultiFileTraceSettingsSource,
  presetName: string,
  record: TraceSettingsRecord | null,
): BatchTraceSettings {
  if (source === 'last-trace' && record !== null) {
    // The grid only fits a crop boundary, which a batch does not use.
    const restored = restoreTraceSettings(record, { width: 1, height: 1 });
    const name = restored.presetName ?? presetName;
    const preset = TRACE_PRESETS[name];
    const overrides = restored.overrides ?? {};
    const adjusted = Object.keys(overrides).length;
    const width = overrides.hybridMaxStrokeWidthMm;
    return {
      options: preset === undefined ? undefined : mergeLightBurnTraceSettings(preset, overrides),
      presetName: name,
      ...(width === undefined ? {} : { hybridMaxStrokeWidthMm: width }),
      label: `the last Trace Image settings (${name}${adjusted === 0 ? '' : `, ${adjusted} adjusted`})`,
    };
  }
  return { options: TRACE_PRESETS[presetName], presetName, label: `the ${presetName} preset` };
}
