// InspectorTimeline — playback transport under the 3D view (ADR-255 stage 5):
// restart / step / play-pause / step / speed, plus a route scrubber. The
// readout shows distance today; stage 8 adds planner-true elapsed time.

import type { PlaybackState } from './use-inspector-playback';

const SPEEDS: ReadonlyArray<number> = [0.25, 0.5, 1, 2, 4, 8];
const STEP_MM = 1;

export function InspectorTimeline(props: {
  readonly playback: PlaybackState;
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
        onClick={() => playback.stepBy(-STEP_MM)}
        title={`Step back ${STEP_MM} mm`}
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
        onClick={() => playback.stepBy(STEP_MM)}
        title={`Step forward ${STEP_MM} mm`}
      >
        ▶|
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(totalRouteMm, 0.001)}
        step={Math.max(totalRouteMm / 2000, 0.001)}
        value={playback.routeMm}
        onChange={(event) => playback.setRouteMm(Number(event.currentTarget.value))}
        style={sliderStyle}
        aria-label="Program position"
      />
      <span style={readoutStyle}>
        {playback.routeMm.toFixed(1)} / {totalRouteMm.toFixed(1)} mm ({percent.toFixed(0)}%)
      </span>
      <label style={speedStyle}>
        Speed
        <select
          value={playback.speed}
          onChange={(event) => playback.setSpeed(Number(event.currentTarget.value))}
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
