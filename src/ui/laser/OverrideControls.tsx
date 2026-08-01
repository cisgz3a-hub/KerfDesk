// OverrideControls — real-time feed/spindle/rapid overrides while a job
// runs (ADR-103 G3, F-CNC21). GRBL applies these instantly mid-stream; the
// live percentages come back in `Ov:` and are cached in ovCache. Rendered
// while a job is streaming/paused, and while Idle when a non-default value
// must be reset before deterministic CNC Start.
//
// On a CNC job the Feed row carries a caption noting it also scales the Z
// plunge: GRBL has no separate plunge override, and plunges are emitted as
// `G1 Z F<plunge>`, so the one feed override scales cutting feed and plunge
// together (matching Easel's single Feed-Rate-Override). It is the same
// firmware behavior a laser has no use for, so the note is CNC-only.

import {
  RT_FEED_OV_MINUS_1,
  RT_FEED_OV_MINUS_10,
  RT_FEED_OV_PLUS_1,
  RT_FEED_OV_PLUS_10,
  RT_FEED_OV_RESET,
  RT_RAPID_OV_FULL,
  RT_RAPID_OV_HALF,
  RT_RAPID_OV_QUARTER,
  RT_SPINDLE_OV_MINUS_1,
  RT_SPINDLE_OV_MINUS_10,
  RT_SPINDLE_OV_PLUS_1,
  RT_SPINDLE_OV_PLUS_10,
  RT_SPINDLE_OV_RESET,
  type RealtimeOverrideByte,
} from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';

export function OverrideControls(): JSX.Element {
  const ovCache = useLaserStore((s) => s.ovCache);
  const send = useLaserStore((s) => s.sendRealtimeOverride);
  const isCncJob = useLaserStore((s) => s.activeJobMachineKind) === 'cnc';
  const fire = (byte: RealtimeOverrideByte): void => {
    void send(byte).catch(() => undefined);
  };
  return (
    <div style={boxStyle} aria-label="Job overrides">
      <OverrideRow
        label="Feed"
        percent={ovCache?.feed ?? null}
        onMinus={() => fire(RT_FEED_OV_MINUS_10)}
        onMinusFine={() => fire(RT_FEED_OV_MINUS_1)}
        onPlusFine={() => fire(RT_FEED_OV_PLUS_1)}
        onPlus={() => fire(RT_FEED_OV_PLUS_10)}
        onReset={() => fire(RT_FEED_OV_RESET)}
      />
      {isCncJob && (
        <span
          style={captionStyle}
          title="GRBL has no separate plunge override — the feed override scales the cutting feed and the Z plunge together."
        >
          Feed also scales plunge
        </span>
      )}
      <OverrideRow
        label="Spindle"
        percent={ovCache?.spindle ?? null}
        onMinus={() => fire(RT_SPINDLE_OV_MINUS_10)}
        onMinusFine={() => fire(RT_SPINDLE_OV_MINUS_1)}
        onPlusFine={() => fire(RT_SPINDLE_OV_PLUS_1)}
        onPlus={() => fire(RT_SPINDLE_OV_PLUS_10)}
        onReset={() => fire(RT_SPINDLE_OV_RESET)}
      />
      <div style={rowStyle}>
        <span style={labelStyle}>Rapids</span>
        <span style={valueStyle}>{ovCache === null ? '—' : `${ovCache.rapid}%`}</span>
        <button
          type="button"
          style={stepButtonStyle}
          onClick={() => fire(RT_RAPID_OV_QUARTER)}
          title="Limit rapid moves to 25% speed."
        >
          25
        </button>
        <button
          type="button"
          style={stepButtonStyle}
          onClick={() => fire(RT_RAPID_OV_HALF)}
          title="Limit rapid moves to 50% speed."
        >
          50
        </button>
        <button
          type="button"
          style={stepButtonStyle}
          onClick={() => fire(RT_RAPID_OV_FULL)}
          title="Restore rapid moves to full speed."
        >
          100
        </button>
      </div>
    </div>
  );
}

// Feed and Spindle each expose coarse ±10% and fine ±1% steps (GRBL 0x91–0x94
// / 0x9A–0x9D), laid out coarse→fine→fine→coarse so the button distance from
// centre matches the step size. Fine steps let the operator dial in a
// chatter-free RPM or feed without overshooting on a ±10% jump.
function OverrideRow(props: {
  readonly label: string;
  readonly percent: number | null;
  readonly onMinus: () => void;
  readonly onMinusFine: () => void;
  readonly onPlusFine: () => void;
  readonly onPlus: () => void;
  readonly onReset: () => void;
}): JSX.Element {
  const name = props.label.toLowerCase();
  const steps = [
    {
      text: '−10',
      onClick: props.onMinus,
      title: `Slow the ${name} override by 10%. Applies instantly mid-job.`,
    },
    {
      text: '−1',
      onClick: props.onMinusFine,
      title: `Slow the ${name} override by 1% (fine step). Applies instantly mid-job.`,
    },
    {
      text: '+1',
      onClick: props.onPlusFine,
      title: `Raise the ${name} override by 1% (fine step). Applies instantly mid-job.`,
    },
    {
      text: '+10',
      onClick: props.onPlus,
      title: `Raise the ${name} override by 10%. Applies instantly mid-job.`,
    },
    {
      text: '100%',
      onClick: props.onReset,
      title: `Reset the ${name} override to 100%.`,
    },
  ];
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <span style={valueStyle}>{props.percent === null ? '—' : `${props.percent}%`}</span>
      {steps.map((step) => (
        <button
          key={step.text}
          type="button"
          style={stepButtonStyle}
          onClick={step.onClick}
          title={step.title}
        >
          {step.text}
        </button>
      ))}
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
// flexWrap lets the buttons drop to a second line on a very narrow rail rather
// than overflowing/clipping — the five-step Feed/Spindle rows are the widest.
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};
const labelStyle: React.CSSProperties = { width: 52, fontSize: 12 };
const valueStyle: React.CSSProperties = {
  width: 40,
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--lf-text-muted)',
};
// Compact so the five Feed/Spindle step buttons (−10 −1 +1 +10 100%) fit the
// narrow machine rail on one line; rowStyle wraps as a fallback if they don't.
const stepButtonStyle: React.CSSProperties = {
  padding: '1px 5px',
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
};
// Sits under the Feed row, indented past the label column (52 + 4 gap) so it
// reads as an annotation on Feed rather than a new control.
const captionStyle: React.CSSProperties = {
  paddingLeft: 56,
  marginTop: -2,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
