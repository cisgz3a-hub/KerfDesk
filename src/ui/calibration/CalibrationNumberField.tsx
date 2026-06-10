import type { ChangeEvent, CSSProperties } from 'react';

export function CalibrationNumberField(props: {
  readonly label: string;
  readonly value: string;
  readonly min: number;
  readonly max: number | undefined;
  readonly step: number | undefined;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      <input
        type="number"
        className="lf-input"
        aria-label={props.label}
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={props.onChange}
        style={inputStyle}
      />
    </label>
  );
}

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  fontSize: 12,
};
const inputStyle: CSSProperties = { width: '100%', boxSizing: 'border-box' };
