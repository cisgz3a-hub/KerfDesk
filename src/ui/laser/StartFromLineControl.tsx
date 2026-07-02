// StartFromLineControl — resume a stopped/errored job from a chosen G-code
// line (ADR-102 G7, F-CNC27). The heavy lifting (readiness gate, modal-state
// replay, confirm, stream) lives in runStartFromLineFlow.

import { useState } from 'react';
import { runStartFromLineFlow } from './start-job-flow';

const MIN_LINE = 1;
const MAX_LINE = 1_000_000;

export function StartFromLineControl(props: {
  readonly disabled: boolean;
  readonly busy: boolean;
}): JSX.Element {
  const [line, setLine] = useState(MIN_LINE);
  const blocked = props.disabled || props.busy;
  return (
    <details style={boxStyle}>
      <summary
        style={summaryStyle}
        title="Resume an interrupted job from a specific G-code line — the recovery for a mid-job stop."
      >
        Start from line…
      </summary>
      <div style={rowStyle}>
        <input
          type="number"
          aria-label="Resume from G-code line"
          title="1-based line number of the exported job to resume from."
          min={MIN_LINE}
          max={MAX_LINE}
          step={1}
          value={line}
          onChange={(e) => {
            const v = Math.floor(Number(e.target.value));
            if (Number.isFinite(v) && v >= MIN_LINE && v <= MAX_LINE) setLine(v);
          }}
          style={inputStyle}
        />
        <button
          type="button"
          disabled={blocked}
          onClick={() => void runStartFromLineFlow(line)}
          title="Rebuild spindle/feed/position state at that line and replay the rest of the job. Work zero must be unchanged."
        >
          Resume from line
        </button>
      </div>
      <p style={hintStyle}>
        Requires the same work zero as the original run. The spindle restarts, moves to the recorded
        position at safe height, feeds back to depth, then continues.
      </p>
    </details>
  );
}

const boxStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '4px 6px',
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6, margin: '6px 0' };
const inputStyle: React.CSSProperties = { width: 90 };
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '2px 0 4px 0',
};
