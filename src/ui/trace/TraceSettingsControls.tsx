import { DEFAULT_LIGHTBURN_TRACE_SETTINGS, type TraceOptions } from '../../core/trace';
import {
  DEFAULT_EDGE_DETAIL,
  DEFAULT_EDGE_MINIMUM_LINE_PX,
  DEFAULT_EDGE_SENSITIVITY,
  edgeDetailFromOptions,
  edgeSensitivityFromOptions,
  mergeLightBurnTraceSettings,
  type LightBurnTraceSettingOverrides,
} from './trace-options';
import { TraceDetectionControls } from './TraceDetectionControls';

type TraceSettingsControlsProps = {
  readonly preset: TraceOptions;
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly sourceHasTransparency?: boolean | undefined;
  readonly onChange: (next: LightBurnTraceSettingOverrides) => void;
};

export function TraceSettingsControls(props: TraceSettingsControlsProps): JSX.Element {
  return props.preset.traceMode === 'edge' ? (
    <EdgeTraceSettingsControls {...props} />
  ) : (
    <FilledTraceSettingsControls {...props} />
  );
}

function EdgeTraceSettingsControls(props: TraceSettingsControlsProps): JSX.Element {
  const set = (patch: LightBurnTraceSettingOverrides): void => {
    props.onChange({ ...props.overrides, ...patch });
  };
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>Trace settings</legend>
      <NumberRow
        label="Sensitivity"
        min={0}
        max={100}
        step={1}
        value={
          props.overrides.edgeSensitivity ??
          edgeSensitivityFromOptions(props.preset) ??
          DEFAULT_EDGE_SENSITIVITY
        }
        onChange={(edgeSensitivity) => set({ edgeSensitivity })}
      />
      <NumberRow
        label="Detail"
        min={0}
        max={100}
        step={1}
        value={
          props.overrides.edgeDetail ?? edgeDetailFromOptions(props.preset) ?? DEFAULT_EDGE_DETAIL
        }
        onChange={(edgeDetail) => set({ edgeDetail })}
      />
      <NumberRow
        label="Minimum line"
        min={0}
        max={1000}
        step={1}
        value={
          props.overrides.edgeMinimumLinePx ??
          props.preset.edgeMinLengthPx ??
          DEFAULT_EDGE_MINIMUM_LINE_PX
        }
        onChange={(edgeMinimumLinePx) => set({ edgeMinimumLinePx })}
      />
      <ContourGeometryControls {...props} />
      <EdgeTraceModeNote />
      <ResetTraceSettingsButton overrides={props.overrides} onChange={props.onChange} />
    </fieldset>
  );
}

function FilledTraceSettingsControls(props: TraceSettingsControlsProps): JSX.Element {
  const set = (patch: LightBurnTraceSettingOverrides): void => {
    props.onChange({ ...props.overrides, ...patch });
  };
  const alphaMaskChecking = props.sourceHasTransparency === undefined;
  const alphaMaskUnavailable = props.sourceHasTransparency === false;
  const alphaMaskDisabled = alphaMaskChecking || alphaMaskUnavailable;
  const alphaMask =
    !alphaMaskDisabled && traceBooleanValue(props.preset, props.overrides, 'traceTransparency');
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>Trace settings</legend>
      <TraceDetectionControls {...props} alphaMask={alphaMask}>
        <BrightnessBandControls {...props} />
      </TraceDetectionControls>
      <TraceAreaControls {...props} />
      {props.preset.traceMode !== 'centerline' ? <ContourGeometryControls {...props} /> : null}
      <CheckboxRow
        label="Trace alpha mask"
        checked={alphaMask}
        disabled={alphaMaskDisabled}
        onChange={(traceTransparency) => set({ traceTransparency })}
      />
      {alphaMaskChecking ? <AlphaMaskCheckingNote /> : null}
      {alphaMaskUnavailable ? <AlphaMaskUnavailableNote /> : null}
      <ResetTraceSettingsButton overrides={props.overrides} onChange={props.onChange} />
    </fieldset>
  );
}

function BrightnessBandControls(props: TraceSettingsControlsProps): JSX.Element {
  const options = mergeLightBurnTraceSettings(props.preset, props.overrides);
  const cutoffLuma = options.cutoffLuma ?? 0;
  const thresholdLuma = options.thresholdLuma ?? 128;
  const set = (patch: LightBurnTraceSettingOverrides): void =>
    props.onChange({
      ...props.overrides,
      detectionMode: 'manual',
      cutoffLuma,
      thresholdLuma,
      ...patch,
    });
  return (
    <>
      <NumberRow
        label="Cutoff"
        min={0}
        max={255}
        step={1}
        value={cutoffLuma}
        onChange={(next) => set({ cutoffLuma: next })}
      />
      <NumberRow
        label="Threshold"
        min={0}
        max={255}
        step={1}
        value={thresholdLuma}
        onChange={(next) => set({ thresholdLuma: next })}
      />
    </>
  );
}

function TraceAreaControls(props: TraceSettingsControlsProps): JSX.Element {
  const set = (patch: LightBurnTraceSettingOverrides): void =>
    props.onChange({ ...props.overrides, ...patch });
  return (
    <>
      <NumberRow
        label="Remove ink specks"
        min={0}
        max={10000}
        step={1}
        value={props.overrides.despeckleMinPixels ?? props.preset.despeckleMinPixels ?? 0}
        onChange={(despeckleMinPixels) => set({ despeckleMinPixels })}
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
    </>
  );
}

function ContourGeometryControls(props: TraceSettingsControlsProps): JSX.Element {
  const set = (patch: LightBurnTraceSettingOverrides): void => {
    props.onChange({ ...props.overrides, ...patch });
  };
  return (
    <>
      <NumberRow
        label="Smoothness"
        min={0}
        max={1.33}
        step={0.01}
        value={traceValue(props.preset, props.overrides, 'smoothness')}
        onChange={(smoothness) => set({ smoothness })}
      />
      <NumberRow
        label="Optimize"
        min={0}
        max={2}
        step={0.01}
        value={traceValue(props.preset, props.overrides, 'optimize')}
        onChange={(optimize) => set({ optimize })}
      />
    </>
  );
}

type NumericTraceSettingKey = Extract<
  keyof LightBurnTraceSettingOverrides,
  'smoothness' | 'optimize'
>;
type BooleanTraceSettingKey = Extract<keyof LightBurnTraceSettingOverrides, 'traceTransparency'>;

function traceValue(
  preset: TraceOptions,
  overrides: LightBurnTraceSettingOverrides,
  key: NumericTraceSettingKey,
): number {
  const override = overrides[key];
  if (override !== undefined) return override;
  const presetValue = preset[key];
  return presetValue ?? DEFAULT_LIGHTBURN_TRACE_SETTINGS[key];
}

function traceBooleanValue(
  preset: TraceOptions,
  overrides: LightBurnTraceSettingOverrides,
  key: BooleanTraceSettingKey,
): boolean {
  const override = overrides[key];
  if (override !== undefined) return override;
  return preset[key] ?? DEFAULT_LIGHTBURN_TRACE_SETTINGS[key];
}

function ResetTraceSettingsButton(props: {
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly onChange: (next: LightBurnTraceSettingOverrides) => void;
}): JSX.Element {
  return (
    <div style={resetRowStyle}>
      <button
        type="button"
        onClick={() => props.onChange({})}
        disabled={Object.keys(props.overrides).length === 0}
        style={resetButtonStyle}
        title="Reset all trace controls to the selected tracing preset."
      >
        Reset trace settings
      </button>
    </div>
  );
}

function EdgeTraceModeNote(): JSX.Element {
  return (
    <p style={edgeTraceNoteStyle}>
      Traces local contrast as closed outlines around the artwork. Use Centerline for a single path
      down the middle of a stroke.
    </p>
  );
}

function AlphaMaskUnavailableNote(): JSX.Element {
  return (
    <p style={alphaMaskNoteStyle}>
      No transparent pixels detected; alpha mask will not change this image.
    </p>
  );
}

function AlphaMaskCheckingNote(): JSX.Element {
  return <p style={alphaMaskNoteStyle}>Checking image transparency...</p>;
}

function NumberRow(props: {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly onChange: (next: number) => void;
}): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(clamp(Number(e.target.value), props.min, props.max))}
        style={numberStyle}
        aria-label={`Trace ${props.label}`}
        title={traceNumberTitle(props.label)}
      />
    </label>
  );
}

function CheckboxRow(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <label style={checkboxRowStyle}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled === true}
        title={traceCheckboxTitle(props.label)}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function traceNumberTitle(label: string): string {
  switch (label) {
    case 'Cutoff':
      return 'Lowest brightness treated as traceable artwork.';
    case 'Threshold':
      return 'Brightness split used to separate artwork from background.';
    case 'Ignore Less Than':
      return 'Discard closed contours and holes smaller than this source-image pixel area. Zero keeps all areas.';
    case 'Remove ink specks':
      return 'Remove connected ink regions smaller than this source-image pixel area; holes are preserved. Zero disables this filter.';
    case 'Smoothness':
      return 'Smooth traced edges to reduce jagged vector paths.';
    case 'Optimize':
      return 'Simplify traced paths while preserving shape.';
    case 'Sensitivity':
      return 'Higher values keep weaker edges in Edge Detection.';
    case 'Detail':
      return 'Higher values preserve more fine edge detail; lower values smooth noise.';
    case 'Minimum line':
      return 'Discard closed edge outlines whose perimeter is shorter than this many source-image pixels.';
    default:
      return `Trace ${label.toLowerCase()} setting.`;
  }
}

function traceCheckboxTitle(label: string): string {
  switch (label) {
    case 'Trace alpha mask':
      return 'Only changes images with transparent pixels; opaque images trace the same.';
    default:
      return `Toggle ${label.toLowerCase()} for tracing.`;
  }
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '6px 10px 8px 10px',
  margin: '4px 0',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 6,
};
const legendStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  padding: '0 4px',
};
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '82px 1fr',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const numberStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontSize: 12,
};
const resetRowStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  justifyContent: 'flex-end',
};
const checkboxRowStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const edgeTraceNoteStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const alphaMaskNoteStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  margin: '-2px 0 0 22px',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const resetButtonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  background: 'transparent',
  border: '1px solid var(--lf-border)',
  borderRadius: 3,
  cursor: 'pointer',
};
