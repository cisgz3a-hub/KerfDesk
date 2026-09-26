// One numeric trace setting: a labelled number field, a slider for bounded
// ranges, and its hint. Split from TraceSettingsControls to keep that module
// under the line cap.

import { useId } from 'react';

export function NumberRow(props: {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly onChange: (next: number) => void;
  readonly title?: string;
}): JSX.Element {
  const inputId = useId();
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
    case 'Max stroke width':
      return 'Ink up to this wide is traced once down its centre line; wider ink stays a filled outline.';
    case 'Minimum line':
      return 'Discard closed edge outlines whose perimeter is shorter than this many source-image pixels.';
    default:
      return `Trace ${label.toLowerCase()} setting.`;
  }
}
