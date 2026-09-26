// The Trace dialog's operator choices in one place, seeded from the settings
// recorded on the trace being re-traced (ADR-408) or from the defaults.

import { useMemo, useState } from 'react';
import type { RasterImage, TraceSettingsRecord } from '../../core/scene';
import type { TraceOptions } from '../../core/trace';
import type { TraceFillStyle, TraceOutput } from './dialog-parts';
import { mergeLightBurnTraceSettings, type LightBurnTraceSettingOverrides } from './trace-options';
import { captureTraceSettings, restoreTraceSettings } from './trace-settings-snapshot';
import { useBoundarySelection, type BoundarySelection } from './use-boundary-selection';
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
  const boundarySelection = useBoundarySelection(initial);
  const { preset, selectPreset } = useTracePreset(
    machineKind,
    boundarySelection.setBoundaryMode,
    initial.presetName,
  );
  const [traceSettings, setTraceSettings] = useState<LightBurnTraceSettingOverrides>(
    initial.overrides ?? {},
  );
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
        overrides: traceSettings,
        output: traceOutput,
        fillStyle: traceFillStyle,
        boundary: boundarySelection.boundary,
        boundaryMode: boundarySelection.boundaryMode,
      }),
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
