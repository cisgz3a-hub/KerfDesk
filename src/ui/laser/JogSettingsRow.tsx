import { jogFeedOptions } from './jog-control-policy';

const STEPS_MM = [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100] as const;

export function JogSettingsRow(props: {
  readonly disabled: boolean;
  readonly step: number;
  readonly feed: number;
  readonly maxFeed: number;
  readonly onStep: (step: number) => void;
  readonly onFeed: (feed: number) => void;
}): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>Jog</span>
      <label style={fieldStyle}>
        Step
        <select
          value={props.step}
          onChange={(event) => props.onStep(Number(event.target.value))}
          disabled={props.disabled}
          aria-label="Jog step size"
          title="Distance moved by each jog arrow click or keyboard press."
        >
          {STEPS_MM.map((option) => (
            <option key={option} value={option}>
              {option} mm
            </option>
          ))}
        </select>
      </label>
      <label style={fieldStyle}>
        Speed
        <select
          value={props.feed}
          onChange={(event) => props.onFeed(Number(event.target.value))}
          disabled={props.disabled}
          aria-label="Jog speed"
          title="Feed used for XY jogs, in millimeters per minute."
        >
          {jogFeedOptions(props.maxFeed).map((option) => (
            <option key={option} value={option}>
              {option} mm/min
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  flexWrap: 'wrap',
  gap: 8,
};
const labelStyle: React.CSSProperties = { fontWeight: 600 };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 11,
};
