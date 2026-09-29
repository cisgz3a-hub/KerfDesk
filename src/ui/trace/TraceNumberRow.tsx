import { useId } from 'react';
import { TraceAutoCheckbox, type TraceAutoChoice } from './TraceCheckboxRow';
import { traceNumberTitle } from './trace-number-title';

// One numeric trace control: a number input, a slider for byte-sized ranges
// and a visible hint. With `auto`, an Auto checkbox hands the value to the
// engine (ADR-434 Amendment 1); the input is then empty and disabled rather
// than showing a number the engine is not using.
export function NumberRow(props: {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly snapToStep?: boolean; // show the traced stop once typing ends (ADR-437)
  readonly onChange: (next: number) => void;
  readonly title?: string;
  readonly auto?: TraceAutoChoice;
}): JSX.Element {
  const inputId = useId();
  const snapped = clamp(Math.round(props.value / props.step) * props.step, props.min, props.max);
  const hintId = useId();
  const unit = NUMBER_ROW_UNITS[props.label] ?? (props.max === 10000 ? 'px²' : undefined);
  const hasSlider = props.max <= 255;
  const auto = props.auto?.checked === true;
  const title = props.title ?? traceNumberTitle(props.label);
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
            value={auto ? '' : props.value}
            placeholder={auto ? 'Auto' : undefined}
            disabled={auto}
            onChange={(e) => props.onChange(clamp(Number(e.target.value), props.min, props.max))}
            onBlur={() => {
              if (props.snapToStep === true && snapped !== props.value) props.onChange(snapped);
            }}
            aria-label={`Trace ${props.label}`}
            aria-describedby={hintId}
            title={title}
          />
          {unit === undefined ? null : <span>{unit}</span>}
        </span>
      </label>
      {props.auto === undefined ? null : (
        <TraceAutoCheckbox label={props.label} auto={props.auto} />
      )}
      {hasSlider ? (
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          aria-label={`Trace ${props.label} slider`}
          title={title}
          aria-describedby={hintId}
          onChange={(e) => props.onChange(clamp(Number(e.target.value), props.min, props.max))}
        />
      ) : null}
      <p id={hintId}>{title}</p>
    </div>
  );
}

const NUMBER_ROW_UNITS: Readonly<Record<string, string>> = {
  'Minimum line': 'px',
  'Max stroke width': 'mm',
  'Join gaps': 'px',
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
