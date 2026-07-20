import { Row, numInputStyle, unitStyle } from './device-settings-shared';

export function ControlledLaserOffTravelRow(props: {
  readonly value: number | undefined;
  readonly maxFeed: number;
  readonly onChange: (value: number | undefined) => void;
}): JSX.Element {
  const enabled = props.value !== undefined;
  return (
    <Row label="Controlled seek">
      <label style={inlineStyle}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) =>
            props.onChange(
              event.target.checked ? (props.value ?? Math.min(800, props.maxFeed)) : undefined,
            )
          }
          aria-label="Enable controlled laser-off seek travel"
          title="Replace rapid G0 positioning with laser-off G1 positioning at the configured feed. This can substantially increase runtime."
        />
        G1 S0
      </label>
      <input
        aria-label="Controlled laser-off seek feed"
        title="Set the feed rate for laser-off G1 positioning moves when controlled seek is enabled."
        type="number"
        value={props.value ?? 800}
        min={1}
        max={props.maxFeed}
        step={50}
        disabled={!enabled}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value) && value > 0 && value <= props.maxFeed) {
            props.onChange(value);
          }
        }}
        style={numInputStyle}
      />
      <span style={unitStyle}>mm/min</span>
    </Row>
  );
}

const inlineStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  alignItems: 'center',
  fontSize: 12,
};
