// The Trace dialog's operator choices in one place, seeded from the settings
// recorded on the trace being re-traced (ADR-408) or from the defaults.

import { useMemo, useState } from 'react';
import type { RasterImage } from '../../core/scene';
import type { TraceSettingsRecord } from '../../core/scene/scene-object';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { useStore } from '../state';
import type { TraceFillStyle, TraceOutput } from './dialog-parts';
import {
  hybridMaxStrokeWidthMm,
  previewPxPerMm,
  withHybridMaxStrokeWidth,
} from './hybrid-stroke-width';
import { mergeLightBurnTraceSettings, type LightBurnTraceSettingOverrides } from './trace-options';
import { overridesForPresetSwitch } from './trace-preset-switch';
import { captureTraceSettings, restoreTraceSettings } from './trace-settings-snapshot';
import { useBoundarySelection, type BoundarySelection } from './use-boundary-selection';
import { cropOnlyNote } from './BoundaryModePicker';
import { useTracePreset } from './use-trace-preset';

export type TraceDialogSettingsState = {
  readonly boundarySelection: BoundarySelection;
  readonly preset: string;
  readonly selectPreset: (next: string) => void;
  readonly traceSettings: LightBurnTraceSettingOverrides;
  readonly setTraceSettings: (next: LightBurnTraceSettingOverrides) => void;
  readonly traceFillStyle: TraceFillStyle;
  readonly setTraceFillStyle: (next: TraceFillStyle) => void;
  readonly traceOutput: TraceOutput;
  readonly setTraceOutput: (next: TraceOutput) => void;
  readonly deleteSourceAfterTrace: boolean;
  readonly setDeleteSourceAfterTrace: (next: boolean) => void;
  /**
   * The current choices as the record stored on the committed trace. It keeps
   * the operator's intent, not the effective commit: CNC forces vector output
   * and some outputs ignore the fill style, but the same project may be
   * re-traced on a laser later, where those choices apply again (ADR-408).
   */
  readonly record: () => TraceSettingsRecord;
};

export function useTraceDialogSettings(
  machineKind: 'laser' | 'cnc',
  seed: Pick<RasterImage, 'pixelWidth' | 'pixelHeight'>,
  request: {
    readonly replaceTraceId?: string | undefined;
    readonly traceSettings?: TraceSettingsRecord | undefined;
  },
): TraceDialogSettingsState {
  // Restored once per dialog lifetime; later edits belong to the operator.
  const [initial] = useState(() =>
    restoreTraceSettings(request.traceSettings, {
      width: seed.pixelWidth,
      height: seed.pixelHeight,
    }),
  );
  const retrace = request.replaceTraceId !== undefined;
  const { preset, selectPreset: choosePreset } = useTracePreset(machineKind, initial.presetName);
  const boundarySelection = useBoundarySelection(
    initial,
    cropOnlyNote(TRACE_PRESETS[preset]) !== null,
  );
  const device = useStore((s) => s.project.device);
  const [traceSettings, setTraceSettings] = useState<LightBurnTraceSettingOverrides>(
    initial.overrides ?? {},
  );
  // A new preset's own settings replace overrides of them (ADR-434 Amd 1).
  const selectPreset = (next: string): void => {
    setTraceSettings((current) =>
      overridesForPresetSwitch(current, TRACE_PRESETS[preset], TRACE_PRESETS[next]),
    );
    choosePreset(next);
  };
  const [traceFillStyle, setTraceFillStyle] = useState<TraceFillStyle>(
    initial.fillStyle ?? 'scanline',
  );
  const [traceOutput, setTraceOutput] = useState<TraceOutput>(initial.output ?? 'vector');
  // Re-trace Original is reachable only because the source was kept, so a
  // re-trace keeps it again by default; deleting it would end re-tracing.
  const [deleteSourceAfterTrace, setDeleteSourceAfterTrace] = useState(!retrace);
  return {
    boundarySelection,
    preset,
    selectPreset,
    traceSettings,
    setTraceSettings,
    traceFillStyle,
    setTraceFillStyle,
    traceOutput,
    setTraceOutput,
    deleteSourceAfterTrace,
    setDeleteSourceAfterTrace,
    record: () =>
      captureTraceSettings({
        presetName: preset,
        overrides: withResolvedHybridWidth(preset, traceSettings, device, machineKind),
        output: traceOutput,
        fillStyle: traceFillStyle,
        boundary: boundarySelection.boundary,
        boundaryMode: boundarySelection.boundaryMode,
      }),
  };
}

// A Line + fill trace records the Max stroke width it used, default or not
// (ADR-454 rule 10): the default follows the machine's spot size, so a
// Re-trace on another device profile would otherwise re-split the ink.
function withResolvedHybridWidth(
  presetName: string,
  overrides: LightBurnTraceSettingOverrides,
  device: Parameters<typeof hybridMaxStrokeWidthMm>[1],
  machineKind: 'laser' | 'cnc',
): LightBurnTraceSettingOverrides {
  if (TRACE_PRESETS[presetName]?.traceMode !== 'hybrid') return overrides;
  return {
    ...overrides,
    hybridMaxStrokeWidthMm: hybridMaxStrokeWidthMm(overrides, device, machineKind),
  };
}

/** The dialog's effective trace options: the preset merged with the operator's
 *  overrides, memoized so the preview only re-traces when either changes. */
export function useTraceOptions(
  preset: TraceOptions,
  overrides: LightBurnTraceSettingOverrides,
): TraceOptions {
  return useMemo(() => mergeLightBurnTraceSettings(preset, overrides), [preset, overrides]);
}

/** The dialog's trace options; for Line + fill, with the operator's millimetre Max stroke width
 *  converted to preview pixels through the source's placement (ADR-454).
 *  Every other trace mode gets `options` back unchanged. */
export function useDialogTraceOptions(
  preset: TraceOptions,
  overrides: LightBurnTraceSettingOverrides,
  source: RasterImage,
): TraceOptions {
  const options = useTraceOptions(preset, overrides);
  const device = useStore((s) => s.project.device);
  const machineKind = useStore((s) => s.project.machine?.kind);
  const widthMm = hybridMaxStrokeWidthMm(overrides, device, machineKind);
  const pxPerMm = previewPxPerMm(source);
  return useMemo(
    () => withHybridMaxStrokeWidth(options, widthMm, pxPerMm),
    [options, widthMm, pxPerMm],
  );
}
