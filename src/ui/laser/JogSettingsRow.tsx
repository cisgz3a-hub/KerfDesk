import { jogFeedOptions } from './jog-control-policy';
import { useLengthUnit } from '../state/display-units';
import { feedUnitLabel, formatDisplayLength, MM_PER_INCH } from '../display-length';

const STEPS_MM = [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100] as const;
// Inch steps (ADR-629), stored as the millimetres the jog moves.
const STEPS_IN = [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4] as const;

/** The step choices in the display unit, keeping the current step listed. */
export function jogStepOptions(unit: 'mm' | 'in', currentMm: number): ReadonlyArray<number> {
  const options: number[] =
    unit === 'in' ? STEPS_IN.map((inches) => inches * MM_PER_INCH) : [...STEPS_MM];
  if (!options.includes(currentMm)) options.push(currentMm);
  return options.sort((a, b) => a - b);
}

export function JogSettingsRow(props: {
  readonly disabled: boolean;
  readonly step: number;
  readonly feed: number;
  readonly maxFeed: number;
  readonly onStep: (step: number) => void;
  readonly onFeed: (feed: number) => void;
}): JSX.Element {
  const unit = useLengthUnit();
  return (
    <div style={rowStyle}>
      <label style={fieldStyle}>
        Step
        <select
          className="lf-select"
          value={props.step}
          onChange={(event) => props.onStep(Number(event.target.value))}
          disabled={props.disabled}
          aria-label="Jog step size"
          data-search-target="jog"
          title="Distance moved by each jog arrow click."
        >
          {jogStepOptions(unit, props.step).map((option) => (
            <option key={option} value={option}>
              {formatDisplayLength(option, unit)} {unit}
            </option>
          ))}
        </select>
      </label>
      <label style={fieldStyle}>
        Speed
        <select
          className="lf-select"
          value={props.feed}
          onChange={(event) => props.onFeed(Number(event.target.value))}
          disabled={props.disabled}
          aria-label="Jog speed"
          title={`Feed used for XY jogs, in ${unit === 'in' ? 'inches' : 'millimeters'} per minute.`}
        >
          {jogFeedOptions(props.maxFeed).map((option) => (
            <option key={option} value={option}>
              {formatDisplayLength(option, unit)} {feedUnitLabel(unit)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  alignItems: 'flex-end',
  gap: 8,
};
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 'var(--lf-text-sm)',
  minWidth: 0,
};
