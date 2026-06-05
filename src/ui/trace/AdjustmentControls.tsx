// Image-adjustment controls for the trace dialog — surfaces LF1-compatible
// preprocessing levers (brightness / contrast / gamma / invert) and
// the 13-mode dither picker. Each control is a thin wrapper around the
// underlying preset; user changes layer on top of the preset's TraceOptions
// before they reach the preview / committer.
//
// Kept in its own file so ImportImageDialog.tsx stays under the
// 250-line soft cap and the controls module can grow without dragging
// the dialog file with it (e.g. when we add Web Worker offload UI in
// step 5, or "reset to preset defaults" affordances).

import { DITHER_MODES, type DitherMode } from '../../core/trace';

export type AdjustmentValues = {
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
  readonly invert: boolean;
  readonly ditherMode: DitherMode;
};

export const DEFAULT_ADJUSTMENTS: AdjustmentValues = {
  brightness: 0,
  contrast: 0,
  gamma: 1,
  invert: false,
  ditherMode: 'none',
};

export function AdjustmentControls(props: {
  readonly values: AdjustmentValues;
  readonly onChange: (next: AdjustmentValues) => void;
}): JSX.Element {
  const { values, onChange } = props;
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>Image adjustments</legend>
      <SliderRow
        label="Brightness"
        min={-100}
        max={100}
        step={1}
        value={values.brightness}
        display={
          values.brightness === 0
            ? 'off'
            : `${values.brightness > 0 ? '+' : ''}${values.brightness}`
        }
        onChange={(brightness) => onChange({ ...values, brightness })}
      />
      <SliderRow
        label="Contrast"
        min={-100}
        max={100}
        step={1}
        value={values.contrast}
        display={
          values.contrast === 0 ? 'off' : `${values.contrast > 0 ? '+' : ''}${values.contrast}`
        }
        onChange={(contrast) => onChange({ ...values, contrast })}
      />
      <SliderRow
        label="Gamma"
        min={0.1}
        max={5}
        step={0.05}
        value={values.gamma}
        display={values.gamma === 1 ? 'off' : values.gamma.toFixed(2)}
        onChange={(gamma) => onChange({ ...values, gamma })}
      />
      <CheckboxRow
        label="Invert"
        checked={values.invert}
        onChange={(invert) => onChange({ ...values, invert })}
      />
      <DitherRow
        value={values.ditherMode}
        onChange={(ditherMode) => onChange({ ...values, ditherMode })}
      />
      <ResetRow values={values} onChange={onChange} />
    </fieldset>
  );
}

function SliderRow(props: {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly display: string;
  readonly onChange: (next: number) => void;
}): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        style={sliderStyle}
      />
      <span style={valueStyle}>{props.display}</span>
    </label>
  );
}

function CheckboxRow(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <span style={controlStyle}>
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        <span style={{ fontSize: 11, color: '#666' }}>
          {props.checked ? 'swap dark / light' : 'off'}
        </span>
      </span>
    </label>
  );
}

function DitherRow(props: {
  readonly value: DitherMode;
  readonly onChange: (next: DitherMode) => void;
}): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Dither</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as DitherMode)}
        style={selectStyle}
      >
        {DITHER_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResetRow(props: {
  readonly values: AdjustmentValues;
  readonly onChange: (next: AdjustmentValues) => void;
}): JSX.Element {
  const isDefault =
    props.values.brightness === DEFAULT_ADJUSTMENTS.brightness &&
    props.values.contrast === DEFAULT_ADJUSTMENTS.contrast &&
    props.values.gamma === DEFAULT_ADJUSTMENTS.gamma &&
    props.values.invert === DEFAULT_ADJUSTMENTS.invert &&
    props.values.ditherMode === DEFAULT_ADJUSTMENTS.ditherMode;
  return (
    <div style={resetRowStyle}>
      <button
        type="button"
        onClick={() => props.onChange(DEFAULT_ADJUSTMENTS)}
        disabled={isDefault}
        style={resetButtonStyle}
      >
        Reset adjustments
      </button>
    </div>
  );
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 4,
  padding: '6px 10px 8px 10px',
  margin: '4px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const legendStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#666',
  padding: '0 4px',
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
};
const labelStyle: React.CSSProperties = { width: 80, color: '#444' };
const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const sliderStyle: React.CSSProperties = { flex: 1 };
const valueStyle: React.CSSProperties = {
  width: 48,
  textAlign: 'right',
  fontSize: 11,
  color: '#666',
  fontVariantNumeric: 'tabular-nums',
};
const selectStyle: React.CSSProperties = { flex: 1, fontSize: 12 };
const resetRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginTop: 2,
};
const resetButtonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  background: 'transparent',
  border: '1px solid #ccc',
  borderRadius: 3,
  cursor: 'pointer',
};
