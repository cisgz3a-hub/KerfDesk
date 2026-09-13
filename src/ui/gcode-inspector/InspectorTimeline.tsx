// Estimated playback and reported controller progress have separate transports.
// A live job is observational: playback controls never drive a machine.

import type { PlaybackState } from './use-inspector-playback';
import './inspector-viewer.css';

const SPEEDS: ReadonlyArray<number> = [0.25, 0.5, 1, 2, 4, 8];
const STEP_SECONDS = 0.25;
const SECONDS_PER_MINUTE = 60;
const SCRUB_STEPS = 2000;

type ReportedProgress = {
  readonly progress: number | null;
  readonly label: string;
  readonly active?: boolean;
};

function progressPercent(progress: number | null): number | null {
  return progress !== null && Number.isFinite(progress)
    ? Math.min(100, Math.max(0, progress * 100))
    : null;
}

/** m:ss for a clock the operator reads at a glance. */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const minutes = Math.floor(safe / SECONDS_PER_MINUTE);
  const rest = safe % SECONDS_PER_MINUTE;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

export function InspectorTimeline(props: {
  readonly playback: PlaybackState;
  /** Program motion time in planner seconds. */
  readonly totalRouteMm: number;
  readonly live?: ReportedProgress | null;
}): JSX.Element {
  const { playback, totalRouteMm, live } = props;
  const total = Number.isFinite(totalRouteMm) ? Math.max(0, totalRouteMm) : 0;
  const position = Math.max(0, Math.min(total, playback.routeMm));
  const progress = live ? live.progress : total > 0 ? position / total : 0;
  const percent = progressPercent(progress);
  const active = live != null && live.active !== false;
  const label = live
    ? active
      ? 'Live reported progress'
      : 'Recorded run progress'
    : 'Playback estimate';
  return (
    <div className="gcode-viewer-timeline" aria-label={label}>
      <div className="gcode-viewer-timeline-heading">
        <span className="gcode-viewer-timeline-label">
          <span className="gcode-viewer-status-dot" data-live={active} aria-hidden="true" />
          {label}
        </span>
        <span className="gcode-viewer-time-readout">
          {live ? live.label : `${formatClock(position)} / ${formatClock(total)}`}
          <strong>{percent === null ? '—' : `${percent.toFixed(0)}%`}</strong>
        </span>
      </div>
      {live ? (
        <ReportedProgressTrack
          percent={percent}
          active={active}
          label={label}
          detail={live.label}
        />
      ) : (
        <PlaybackTransport playback={playback} total={total} position={position} />
      )}
    </div>
  );
}

function ReportedProgressTrack(props: {
  readonly percent: number | null;
  readonly active: boolean;
  readonly label: string;
  readonly detail: string;
}): JSX.Element {
  const { percent, active, label, detail } = props;
  return (
    <div
      className="gcode-viewer-live-track"
      role="progressbar"
      data-live={active}
      data-unknown={percent === null}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent === null ? undefined : Math.round(percent)}
      aria-valuetext={
        percent === null
          ? `Progress not confirmed · ${detail}`
          : `${percent.toFixed(0)}% · ${detail}`
      }
    >
      {percent === null ? null : <span style={{ width: `${percent}%` }} />}
    </div>
  );
}

function PlaybackTransport(props: {
  readonly playback: PlaybackState;
  readonly total: number;
  readonly position: number;
}): JSX.Element {
  const { playback, total, position } = props;
  return (
    <div className="gcode-viewer-transport">
      <div className="gcode-viewer-transport-buttons" role="group" aria-label="Playback transport">
        <button
          type="button"
          className="lf-btn gcode-viewer-button"
          onClick={playback.restart}
          title="Restart preview playback from the beginning"
        >
          Restart
        </button>
        <button
          type="button"
          className="lf-btn gcode-viewer-button"
          onClick={() => playback.stepBy(-STEP_SECONDS)}
          aria-label={`Step back ${STEP_SECONDS} seconds`}
          title={`Step back ${STEP_SECONDS} seconds`}
          disabled={total <= 0}
        >
          −0.25s
        </button>
        <button
          type="button"
          className="lf-btn gcode-viewer-button gcode-viewer-play-button"
          onClick={playback.togglePlay}
          title={playback.playing ? 'Pause preview playback' : 'Play the estimated toolpath'}
          aria-pressed={playback.playing}
          disabled={total <= 0}
        >
          {playback.playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className="lf-btn gcode-viewer-button"
          onClick={() => playback.stepBy(STEP_SECONDS)}
          aria-label={`Step forward ${STEP_SECONDS} seconds`}
          title={`Step forward ${STEP_SECONDS} seconds`}
          disabled={total <= 0}
        >
          +0.25s
        </button>
      </div>
      <input
        type="range"
        className="gcode-viewer-scrubber"
        min={0}
        max={Math.max(total, 0.001)}
        step={Math.max(total / SCRUB_STEPS, 0.001)}
        value={position}
        onChange={(event) => playback.setRouteMm(Number(event.currentTarget.value))}
        aria-label="Program time"
        title="Scrub through the estimated program time"
        aria-valuetext={`${formatClock(position)} of ${formatClock(total)} estimated`}
        disabled={total <= 0}
      />
      <label className="gcode-viewer-speed">
        Speed
        <select
          value={playback.speed}
          onChange={(event) => playback.setSpeed(Number(event.currentTarget.value))}
          aria-label="Playback speed"
          title="Change preview playback speed"
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
