import { useId } from 'react';
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
    <fieldset className="lf-trace-settings">
      <legend>Refine detail</legend>
      <div className="lf-trace-settings-group">
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
      </div>
      <EdgeTraceModeNote />
      <details className="lf-trace-settings-details">
        <summary tabIndex={0}>Curve finishing</summary>
        <ContourGeometryControls {...props} />
      </details>
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
    <fieldset className="lf-trace-settings">
      <legend>Refine detail</legend>
      <div className="lf-trace-settings-group">
        <TraceDetectionControls {...props} alphaMask={alphaMask}>
          <BrightnessBandControls {...props} />
        </TraceDetectionControls>
      </div>
      <div className="lf-trace-settings-group">
        <TraceAreaControls {...props} />
      </div>
      {props.preset.traceMode !== 'centerline' ? (
        <details className="lf-trace-settings-details">
          <summary tabIndex={0}>Curve finishing</summary>
          <ContourGeometryControls {...props} />
        </details>
      ) : null}
      <details className="lf-trace-settings-details">
        <summary tabIndex={0}>Transparency</summary>
        <CheckboxRow
          label="Trace alpha mask"
          checked={alphaMask}
          disabled={alphaMaskDisabled}
          onChange={(traceTransparency) => set({ traceTransparency })}
        />
        {alphaMaskChecking ? <AlphaMaskCheckingNote /> : null}
        {alphaMaskUnavailable ? <AlphaMaskUnavailableNote /> : null}
      </details>
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
    <div className="lf-trace-reset-row">
      <button
        type="button"
        onClick={() => props.onChange({})}
        disabled={Object.keys(props.overrides).length === 0}
        className="lf-btn"
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
      Closed outlines around dark artwork and locally darker detail. Adjacent dark tones may merge
      into one outline. Use Centerline for a single path down the middle of a stroke.
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
  const inputId = useId();
  const hintId = useId();
  const unit = props.max === 10000 ? 'px²' : props.label === 'Minimum line' ? 'px' : undefined;
  const hasSlider = props.max <= 255;
  return (
    <div className="lf-trace-number">
      <label htmlFor={inputId}>
        <span>{props.label}</span>
        <span className="lf-trace-number-input">
          <input
            id={inputId}
            className="lf-input"
            type="number"
            min={props.min}
            max={props.max}
            step={props.step}
            value={props.value}
            onChange={(e) => props.onChange(clamp(Number(e.target.value), props.min, props.max))}
            aria-label={`Trace ${props.label}`}
            aria-describedby={hintId}
            title={traceNumberTitle(props.label)}
          />
          {unit === undefined ? null : <span>{unit}</span>}
        </span>
      </label>
      {hasSlider ? (
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          aria-label={`Trace ${props.label} slider`}
          aria-describedby={hintId}
          onChange={(e) => props.onChange(clamp(Number(e.target.value), props.min, props.max))}
        />
      ) : null}
      <p id={hintId}>{traceNumberTitle(props.label)}</p>
    </div>
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
      return 'Exclude artwork darker than this brightness.';
    case 'Threshold':
      return 'Raise this to include lighter marks; lower it to keep darker ink.';
    case 'Ignore Less Than':
      return 'Remove shapes and holes below this pixel area. Use 0 to keep the smallest gaps.';
    case 'Remove ink specks':
      return 'Remove ink marks below this pixel area. Lower values keep fine detail; holes stay intact.';
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
