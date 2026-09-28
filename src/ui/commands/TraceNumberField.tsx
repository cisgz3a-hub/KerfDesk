// A number field for the Multi-File Trace dialog that keeps the typed text,
// reports a value only when it is in range, and marks the field invalid
// otherwise. An invalid field blocks the form's submit, so a batch never runs
// with a value other than the one shown.

import { useState } from 'react';

export type TraceNumberFieldProps = {
  readonly label: string;
  readonly ariaLabel: string;
  readonly title: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** What a cleared field means; omitted, a cleared field is invalid. */
  readonly blankValue?: number;
  /** Whether the lower bound itself is allowed (default true). */
  readonly minInclusive?: boolean;
  readonly unit: string;
  readonly onValue: (value: number) => void;
};

/** The field's value, or null when the text is not a value the field takes. */
export function parseTraceNumber(
  text: string,
  props: Pick<TraceNumberFieldProps, 'min' | 'max' | 'blankValue' | 'minInclusive'>,
): number | null {
  if (text.trim() === '') return props.blankValue ?? null;
  const value = Number(text);
  if (!Number.isFinite(value) || value > props.max) return null;
  const aboveMin = props.minInclusive === false ? value > props.min : value >= props.min;
  return aboveMin ? value : null;
}

export function TraceNumberField(props: TraceNumberFieldProps): JSX.Element {
  const [text, setText] = useState(String(props.value));
  const lower = props.minInclusive === false ? 'above' : 'from';
  const message = `Enter a value ${lower} ${props.min} to ${props.max} ${props.unit}.`;
  return (
    <label className="lf-field">
      <span>{props.label}</span>
      <input
        className="lf-input"
        type="number"
        min={props.min}
        max={props.max}
        step="any"
        aria-label={props.ariaLabel}
        title={props.title}
        value={text}
        aria-invalid={parseTraceNumber(text, props) === null}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          const value = parseTraceNumber(next, props);
          event.currentTarget.setCustomValidity(value === null ? message : '');
          if (value !== null) props.onValue(value);
        }}
      />
    </label>
  );
}
