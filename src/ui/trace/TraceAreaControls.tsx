import type { TraceOptions } from '../../core/trace';
import { AUTO_CANDIDATE_AREA_PX } from '../../core/trace/small-mark-policy';
import {
  mergeLightBurnTraceSettings,
  smallMarkControlState,
  type LightBurnTraceSettingOverrides,
} from './trace-options';
import { TraceCheckboxRow } from './TraceCheckboxRow';
import { NumberRow } from './TraceNumberRow';
import { useStore } from '../state';
import { HYBRID_MAX_STROKE_WIDTH_MM_RANGE, hybridMaxStrokeWidthMm } from './hybrid-stroke-width';

type TraceAreaControlsProps = {
  readonly preset: TraceOptions;
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly onChange: (next: LightBurnTraceSettingOverrides) => void;
};

// The small-mark and small-shape filters. "Remove ink specks" and "Fill tiny
// holes" are each Auto (the engine judges every mark, ADR-434) or an exact
// value (ADR-434 Amendment 1). The controls read the merged options, so they
// show what the engine receives rather than a 0 / unticked stand-in for Auto.
export function TraceAreaControls(props: TraceAreaControlsProps): JSX.Element {
  const set = (patch: LightBurnTraceSettingOverrides): void =>
    props.onChange({ ...props.overrides, ...patch });
  // undefined drops the override so the preset's own choice applies.
  const setOrClear = <K extends 'despeckleMinPixels' | 'fillPinholeCracks'>(
    key: K,
    value: LightBurnTraceSettingOverrides[K] | undefined,
  ): void => {
    const rest = Object.fromEntries(Object.entries(props.overrides).filter(([k]) => k !== key));
    const next = value === undefined ? rest : { ...rest, [key]: value };
    props.onChange(next as LightBurnTraceSettingOverrides);
  };
  const state = smallMarkControlState(mergeLightBurnTraceSettings(props.preset, props.overrides));
  // Auto on a preset whose own choice is Auto is simply "no override".
  const presetState = smallMarkControlState(props.preset);
  return (
    <>
      <NumberRow
        label="Remove ink specks"
        min={0}
        max={10000}
        step={1}
        value={state.inkMinPixels}
        onChange={(despeckleMinPixels) => set({ despeckleMinPixels })}
        auto={{
          checked: state.inkAuto,
          // Leaving Auto restores a fixed-cleanup preset's own value; on an
          // Auto preset it starts at Auto's candidate ceiling (12 px²).
          onChange: (auto) =>
            setOrClear(
              'despeckleMinPixels',
              presetState.inkAuto === auto ? undefined : auto ? 'auto' : AUTO_CANDIDATE_AREA_PX,
            ),
        }}
      />
      {props.preset.traceMode !== 'centerline' ? (
        <NumberRow
          label="Ignore Less Than"
          min={0}
          max={10000}
          step={1}
          value={props.overrides.ignoreLessThanPixels ?? props.preset.ignoreLessThanPixels ?? 0}
          onChange={(ignoreLessThanPixels) => set({ ignoreLessThanPixels })}
        />
      ) : null}
      {props.preset.traceMode === 'hybrid' ? <HybridStrokeWidthRow {...props} /> : null}
      <TraceCheckboxRow
        label="Fill tiny holes"
        checked={state.fillHoles}
        onChange={(fillPinholeCracks) => set({ fillPinholeCracks })}
        auto={{
          checked: state.holesAuto,
          // Leaving Auto restores a fixed-cleanup preset's own choice; on an
          // Auto preset it starts unticked: fill none until asked.
          onChange: (auto) =>
            setOrClear(
              'fillPinholeCracks',
              presetState.holesAuto === auto ? undefined : auto ? 'auto' : false,
            ),
        }}
      />
    </>
  );
}

// Line + fill (ADR-454): ink up to this wide on the placed artwork burns
// once down its centre; wider ink stays a filled outline.
function HybridStrokeWidthRow(props: TraceAreaControlsProps): JSX.Element {
  const device = useStore((s) => s.project.device);
  const machineKind = useStore((s) => s.project.machine?.kind);
  return (
    <NumberRow
      label="Max stroke width"
      min={HYBRID_MAX_STROKE_WIDTH_MM_RANGE.min}
      max={HYBRID_MAX_STROKE_WIDTH_MM_RANGE.max}
      step={0.05}
      value={hybridMaxStrokeWidthMm(props.overrides, device, machineKind)}
      onChange={(hybridMaxStrokeWidthMm) =>
        props.onChange({ ...props.overrides, hybridMaxStrokeWidthMm })
      }
    />
  );
}
