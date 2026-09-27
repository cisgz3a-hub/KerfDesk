// One numeric trace setting: a labelled number field, a slider for bounded
// ranges, and its hint. Split from TraceSettingsControls to keep that module
// under the line cap.

import { useId } from 'react';
import { traceNumberTitle } from './trace-number-title';

export function NumberRow(props: {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly snapToStep?: boolean; // show the traced stop once typing ends (ADR-437)
  readonly onChange: (next: number) => void;
  readonly title?: string;
}): JSX.Element {
  const inputId = useId();
  const snapped = clamp(Math.round(props.value / props.step) * props.step, props.min, props.max);
  const hintId = useId();
  const unit = NUMBER_ROW_UNITS[props.label] ?? (props.max === 10000 ? 'px²' : undefined);
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
            onBlur={() => {
              if (props.snapToStep === true && snapped !== props.value) props.onChange(snapped);
            }}
            aria-label={`Trace ${props.label}`}
            aria-describedby={hintId}
            title={props.title ?? traceNumberTitle(props.label)}
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
          title={props.title ?? traceNumberTitle(props.label)}
          aria-describedby={hintId}
          onChange={(e) => props.onChange(clamp(Number(e.target.value), props.min, props.max))}
        />
      ) : null}
      <p id={hintId}>{props.title ?? traceNumberTitle(props.label)}</p>
    </div>
  );
}

const NUMBER_ROW_UNITS: Readonly<Record<string, string>> = {
  'Minimum line': 'px',
  'Max stroke width': 'mm',
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
