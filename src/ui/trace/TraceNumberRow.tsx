import { useId } from 'react';
import { DraftNumberInput } from '../kit/DraftNumberInput';
import { TraceAutoCheckbox, type TraceAutoChoice } from './TraceCheckboxRow';
import { traceNumberTitle } from './trace-number-title';

// One numeric trace control: a number input, a slider for byte-sized ranges
// and a visible hint. With `auto`, an Auto checkbox hands the value to the
// engine (ADR-434 Amendment 1); the input is then empty and disabled rather
// than showing a number the engine is not using.
type NumberRowProps = {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly snapToStep?: boolean; // show the traced stop once typing ends (ADR-437)
  readonly onChange: (next: number) => void;
  readonly title?: string;
  readonly auto?: TraceAutoChoice;
};

export function NumberRow(props: NumberRowProps): JSX.Element {
  const inputId = useId();
  const hintId = useId();
  const unit = NUMBER_ROW_UNITS[props.label] ?? (props.max === 10000 ? 'px²' : undefined);
  const hasSlider = props.max <= 255;
  const title = props.title ?? traceNumberTitle(props.label);
  return (
    <div className="lf-trace-number">
      <label htmlFor={inputId}>
        <span>{props.label}</span>
        <span className="lf-trace-number-input">
          <NumberRowInput number={props} inputId={inputId} hintId={hintId} title={title} />
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

function NumberRowInput(props: {
  readonly number: NumberRowProps;
  readonly inputId: string;
  readonly hintId: string;
  readonly title: string;
}): JSX.Element {
  const field = props.number;
  const inputProps = {
    id: props.inputId,
    min: field.min,
    max: field.max,
    step: field.step,
    'aria-label': `Trace ${field.label}`,
    'aria-describedby': props.hintId,
    title: props.title,
  };
  if (field.auto?.checked === true)
    return (
      <input
        {...inputProps}
        type="number"
        className="lf-input"
        title={props.title}
        value=""
        placeholder="Auto"
        disabled
      />
    );
  return (
    <DraftNumberInput
      {...inputProps}
      value={field.value}
      normalize={(next) => clamp(next, field.min, field.max)}
      onValueChange={field.onChange}
      onBlur={() => {
        const snapped = clamp(
          Math.round(field.value / field.step) * field.step,
          field.min,
          field.max,
        );
        if (field.snapToStep === true && snapped !== field.value) field.onChange(snapped);
      }}
    />
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
