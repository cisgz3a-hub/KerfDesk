// OverrideControls — real-time feed/spindle/rapid overrides while a job
// runs (ADR-102 G3, F-CNC21). GRBL applies these instantly mid-stream; the
// live percentages come back in `Ov:` and are cached in ovCache. Rendered
// by JobControls only while a job is streaming or paused.

import {
  RT_FEED_OV_MINUS_10,
  RT_FEED_OV_PLUS_10,
  RT_FEED_OV_RESET,
  RT_RAPID_OV_FULL,
  RT_RAPID_OV_HALF,
  RT_RAPID_OV_QUARTER,
  RT_SPINDLE_OV_MINUS_10,
  RT_SPINDLE_OV_PLUS_10,
  RT_SPINDLE_OV_RESET,
  type RealtimeOverrideByte,
} from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';

export function OverrideControls(): JSX.Element {
  const ovCache = useLaserStore((s) => s.ovCache);
  const send = useLaserStore((s) => s.sendRealtimeOverride);
  const fire = (byte: RealtimeOverrideByte): void => {
    void send(byte).catch(() => undefined);
  };
  return (
    <div style={boxStyle} aria-label="Job overrides">
      <OverrideRow
        label="Feed"
        percent={ovCache?.feed ?? null}
        onMinus={() => fire(RT_FEED_OV_MINUS_10)}
        onPlus={() => fire(RT_FEED_OV_PLUS_10)}
        onReset={() => fire(RT_FEED_OV_RESET)}
      />
      <OverrideRow
        label="Spindle"
        percent={ovCache?.spindle ?? null}
        onMinus={() => fire(RT_SPINDLE_OV_MINUS_10)}
        onPlus={() => fire(RT_SPINDLE_OV_PLUS_10)}
        onReset={() => fire(RT_SPINDLE_OV_RESET)}
      />
      <div style={rowStyle}>
        <span style={labelStyle}>Rapids</span>
        <span style={valueStyle}>{ovCache === null ? '—' : `${ovCache.rapid}%`}</span>
        <button
          type="button"
          onClick={() => fire(RT_RAPID_OV_QUARTER)}
          title="Limit rapid moves to 25% speed."
        >
          25
        </button>
        <button
          type="button"
          onClick={() => fire(RT_RAPID_OV_HALF)}
          title="Limit rapid moves to 50% speed."
        >
          50
        </button>
        <button
          type="button"
          onClick={() => fire(RT_RAPID_OV_FULL)}
          title="Restore rapid moves to full speed."
        >
          100
        </button>
      </div>
    </div>
  );
}

function OverrideRow(props: {
  readonly label: string;
  readonly percent: number | null;
  readonly onMinus: () => void;
  readonly onPlus: () => void;
  readonly onReset: () => void;
}): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <span style={valueStyle}>{props.percent === null ? '—' : `${props.percent}%`}</span>
      <button
        type="button"
        onClick={props.onMinus}
        title={`Slow the ${props.label.toLowerCase()} override by 10%. Applies instantly mid-job.`}
      >
        −10
      </button>
      <button
        type="button"
        onClick={props.onPlus}
        title={`Raise the ${props.label.toLowerCase()} override by 10%. Applies instantly mid-job.`}
      >
        +10
      </button>
      <button
        type="button"
        onClick={props.onReset}
        title={`Reset the ${props.label.toLowerCase()} override to 100%.`}
      >
        100%
      </button>
    </div>
  );
}

const boxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '4px 6px',
  marginTop: 6,
};
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };
const labelStyle: React.CSSProperties = { width: 52, fontSize: 12 };
const valueStyle: React.CSSProperties = {
  width: 40,
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--lf-text-muted)',
};
