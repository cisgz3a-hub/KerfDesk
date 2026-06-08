import { DEFAULT_LIGHTBURN_TRACE_SETTINGS, type TraceOptions } from '../../core/trace';
import type { LightBurnTraceSettingOverrides } from './trace-options';

export function TraceSettingsControls(props: {
  readonly preset: TraceOptions;
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly onChange: (next: LightBurnTraceSettingOverrides) => void;
}): JSX.Element {
  const set = (patch: LightBurnTraceSettingOverrides): void => {
    props.onChange({ ...props.overrides, ...patch });
  };
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>Trace settings</legend>
      <NumberRow
        label="Cutoff"
        min={0}
        max={255}
        step={1}
        value={traceValue(props.preset, props.overrides, 'cutoffLuma')}
        onChange={(cutoffLuma) => set({ cutoffLuma })}
      />
      <NumberRow
        label="Threshold"
        min={0}
        max={255}
        step={1}
        value={traceValue(props.preset, props.overrides, 'thresholdLuma')}
        onChange={(thresholdLuma) => set({ thresholdLuma })}
      />
      <NumberRow
        label="Ignore Less Than"
        min={0}
        max={10000}
        step={1}
        value={traceValue(props.preset, props.overrides, 'ignoreLessThanPixels')}
        onChange={(ignoreLessThanPixels) => set({ ignoreLessThanPixels })}
      />
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
      <div style={resetRowStyle}>
        <button
          type="button"
          onClick={() => props.onChange({})}
          disabled={Object.keys(props.overrides).length === 0}
          style={resetButtonStyle}
        >
          Reset trace settings
        </button>
      </div>
    </fieldset>
  );
}

type TraceSettingKey = keyof LightBurnTraceSettingOverrides;

function traceValue(
  preset: TraceOptions,
  overrides: LightBurnTraceSettingOverrides,
  key: TraceSettingKey,
): number {
  const override = overrides[key];
  if (override !== undefined) return override;
  if (key === 'ignoreLessThanPixels') {
    return (
      preset.ignoreLessThanPixels ??
      preset.despeckleMinPixels ??
      DEFAULT_LIGHTBURN_TRACE_SETTINGS.ignoreLessThanPixels
    );
  }
  const presetValue = preset[key];
  return presetValue ?? DEFAULT_LIGHTBURN_TRACE_SETTINGS[key];
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
      />
    </label>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 4,
  padding: '6px 10px 8px 10px',
  margin: '4px 0',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 6,
};
const legendStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#666',
  padding: '0 4px',
};
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '82px 1fr',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
const labelStyle: React.CSSProperties = { color: '#444' };
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
const resetButtonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  background: 'transparent',
  border: '1px solid #ccc',
  borderRadius: 3,
  cursor: 'pointer',
};
