import type { ChangeEvent, CSSProperties } from 'react';

export function CalibrationNumberField(props: {
  readonly label: string;
  readonly value: string;
  readonly min: number;
  readonly max: number | undefined;
  // 'any' opts out of native step validation for free-form mm fields whose
  // real validation lives in core code (a numeric step misaligned with min
  // makes the browser block form submission on legitimate values).
  readonly step: number | 'any' | undefined;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      <input
        type="number"
        className="lf-input"
        aria-label={props.label}
        title={`Set ${props.label.toLowerCase()} for this generated test pattern.`}
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
