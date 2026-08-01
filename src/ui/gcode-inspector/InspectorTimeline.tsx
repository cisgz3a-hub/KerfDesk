// InspectorTimeline — playback transport under the 3D view (ADR-255 stage 5;
// time-true since stage 8b): restart / step / play-pause / step / speed, plus
// a scrubber. The readout is planner seconds, so 1× runs at machine pace.

import type { PlaybackState } from './use-inspector-playback';

const SPEEDS: ReadonlyArray<number> = [0.25, 0.5, 1, 2, 4, 8];
const STEP_SECONDS = 0.25;
const SECONDS_PER_MINUTE = 60;
const SCRUB_STEPS = 2000;

/** m:ss for a clock the operator reads at a glance. */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / SECONDS_PER_MINUTE);
  const rest = safe % SECONDS_PER_MINUTE;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

export function InspectorTimeline(props: {
  readonly playback: PlaybackState;
  /** Program motion time in planner seconds. */
  readonly totalRouteMm: number;
}): JSX.Element {
  const { playback, totalRouteMm } = props;
  const percent = totalRouteMm <= 0 ? 0 : (playback.routeMm / totalRouteMm) * 100;
  return (
    <div style={barStyle} aria-label="Playback">
      <button type="button" className="lf-btn" onClick={playback.restart} title="Back to start">
        ⏮
      </button>
      <button
        type="button"
        className="lf-btn"
        onClick={() => playback.stepBy(-STEP_SECONDS)}
        title={`Step back ${STEP_SECONDS} s`}
      >
        ◀
      </button>
      <button
        type="button"
        className="lf-btn"
        onClick={playback.togglePlay}
        title={playback.playing ? 'Pause' : 'Play'}
        aria-pressed={playback.playing}
      >
        {playback.playing ? '⏸' : '▶'}
      </button>
      <button
        type="button"
        className="lf-btn"
        onClick={() => playback.stepBy(STEP_SECONDS)}
        title={`Step forward ${STEP_SECONDS} s`}
      >
        ▶|
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(totalRouteMm, 0.001)}
        step={Math.max(totalRouteMm / SCRUB_STEPS, 0.001)}
        value={playback.routeMm}
        onChange={(event) => playback.setRouteMm(Number(event.currentTarget.value))}
        style={sliderStyle}
        title="Scrub to a moment in the program"
        aria-label="Program time"
      />
      <span style={readoutStyle}>
        {formatClock(playback.routeMm)} / {formatClock(totalRouteMm)} ({percent.toFixed(0)}%)
      </span>
      <label style={speedStyle}>
        Speed
        <select
          value={playback.speed}
          onChange={(event) => playback.setSpeed(Number(event.currentTarget.value))}
          title="How fast playback advances through the program"
          aria-label="Playback speed"
        >
          {SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  borderTop: '1px solid var(--lf-border)',
};

const sliderStyle: React.CSSProperties = { flex: 1, minWidth: 80 };

const readoutStyle: React.CSSProperties = {
  fontSize: 'var(--lf-text-sm)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

const speedStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 'var(--lf-text-sm)',
};
