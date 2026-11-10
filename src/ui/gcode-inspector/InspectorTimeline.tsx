// Estimated playback and reported controller progress have separate transports.
// A live job is observational: playback controls never drive a machine.
// ADR-701: one compact row of icon buttons, a scrubber that shows where the
// program cuts and travels, the clock, speed and trail.

import { useMemo } from 'react';
import type { PlaybackState } from './use-inspector-playback';
import { timelineBandsGradient, type TimelineBand } from './timeline-bands';
import { ViewerIcon, type ViewerIconName } from './viewer-icons';
import './inspector-viewer.css';

const SPEEDS: ReadonlyArray<number> = [0.25, 0.5, 1, 2, 4, 8];
// Seconds of done moves the trail keeps bold behind the tool; 0 keeps all.
const TRAILS: ReadonlyArray<number> = [0, 60, 20, 5];

export type TrailChoice = {
  readonly seconds: number;
  readonly onChange: (seconds: number) => void;
};
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
  /** The playback trail (ADR-470); absent where the view has none. */
  readonly trail?: TrailChoice;
  /** Program motion time in planner seconds. */
  readonly totalRouteMm: number;
  readonly live?: ReportedProgress | null;
  /** Cut and travel stretches drawn along the scrubber (ADR-701). */
  readonly bands?: ReadonlyArray<TimelineBand>;
}): JSX.Element {
  const { playback, totalRouteMm, live } = props;
  const total = Number.isFinite(totalRouteMm) ? Math.max(0, totalRouteMm) : 0;
  const position = Math.max(0, Math.min(total, playback.routeMm));
  if (live) return <ReportedProgressBar live={live} />;
  return (
    <div className="gcode-viewer-timeline" aria-label="Playback estimate">
      <div className="gcode-viewer-transport">
        <TransportButtons playback={playback} empty={total <= 0} />
        <Scrubber
          playback={playback}
          total={total}
          position={position}
          bands={props.bands ?? NO_BANDS}
        />
        <span
          className="gcode-viewer-time-readout"
          title="Playback estimate: timed from the machine's motion limits"
        >
          {formatClock(position)}{' '}
          <span className="gcode-viewer-time-total">/ {formatClock(total)} est.</span>
        </span>
        <SpeedSelect playback={playback} />
        {props.trail !== undefined ? <TrailSelect trail={props.trail} /> : null}
      </div>
    </div>
  );
}

const NO_BANDS: ReadonlyArray<TimelineBand> = [];

// A started job's reported progress: observational, so no transport.
function ReportedProgressBar({ live }: { readonly live: ReportedProgress }): JSX.Element {
  const percent = progressPercent(live.progress);
  const active = live.active !== false;
  const label = active ? 'Live reported progress' : 'Recorded run progress';
  return (
    <div className="gcode-viewer-timeline" aria-label={label}>
      <div className="gcode-viewer-timeline-heading">
        <span className="gcode-viewer-timeline-label">
          <span className="gcode-viewer-status-dot" data-live={active} aria-hidden="true" />
          {label}
        </span>
        <span className="gcode-viewer-time-readout">
          {live.label}
          <strong>{percent === null ? '—' : `${percent.toFixed(0)}%`}</strong>
        </span>
      </div>
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
            ? `Progress not confirmed · ${live.label}`
            : `${percent.toFixed(0)}% · ${live.label}`
        }
      >
        {percent === null ? null : <span style={{ width: `${percent}%` }} />}
      </div>
    </div>
  );
}

function TransportButtons(props: {
  readonly playback: PlaybackState;
  readonly empty: boolean;
}): JSX.Element {
  const { playback, empty } = props;
  return (
    <div className="gcode-viewer-transport-buttons" role="group" aria-label="Playback transport">
      <TransportButton
        icon="restart"
        label="Restart"
        title="Restart preview playback from the beginning"
        onClick={playback.restart}
      />
      <TransportButton
        icon="step-back"
        label={`Step back ${STEP_SECONDS} seconds`}
        onClick={() => playback.stepBy(-STEP_SECONDS)}
        disabled={empty}
      />
      <button
        type="button"
        className="lf-btn gcode-viewer-icon-button gcode-viewer-play-button"
        onClick={playback.togglePlay}
        aria-label={playback.playing ? 'Pause' : 'Play'}
        title={playback.playing ? 'Pause preview playback' : 'Play the estimated toolpath'}
        aria-pressed={playback.playing}
        disabled={empty}
      >
        <ViewerIcon name={playback.playing ? 'pause' : 'play'} size={14} />
      </button>
      <TransportButton
        icon="step-forward"
        label={`Step forward ${STEP_SECONDS} seconds`}
        onClick={() => playback.stepBy(STEP_SECONDS)}
        disabled={empty}
      />
    </div>
  );
}

function TransportButton(props: {
  readonly icon: ViewerIconName;
  readonly label: string;
  readonly title?: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn gcode-viewer-icon-button"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.title ?? props.label}
      disabled={props.disabled ?? false}
    >
      <ViewerIcon name={props.icon} size={15} />
    </button>
  );
}

// The range input sits over a track drawn with the program's cut and travel
// stretches; the part still to play is dimmed.
function Scrubber(props: {
  readonly playback: PlaybackState;
  readonly total: number;
  readonly position: number;
  readonly bands: ReadonlyArray<TimelineBand>;
}): JSX.Element {
  const { playback, total, position } = props;
  const gradient = useMemo(() => timelineBandsGradient(props.bands), [props.bands]);
  const done = total > 0 ? (position / total) * 100 : 0;
  return (
    <div className="gcode-viewer-scrub">
      <div
        className="gcode-viewer-scrub-track"
        style={gradient === undefined ? undefined : { backgroundImage: gradient }}
        aria-hidden="true"
      >
        <span className="gcode-viewer-scrub-rest" style={{ left: `${done}%` }} />
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
    </div>
  );
}

function SpeedSelect({ playback }: { readonly playback: PlaybackState }): JSX.Element {
  return (
    <select
      className="gcode-viewer-chip-select"
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
  );
}

function TrailSelect({ trail }: { readonly trail: TrailChoice }): JSX.Element {
  return (
    <select
      className="gcode-viewer-chip-select gcode-viewer-trail"
      value={trail.seconds}
      onChange={(event) => trail.onChange(Number(event.currentTarget.value))}
      aria-label="Playback trail"
      title="How much of the finished path stays bold behind the tool during playback"
    >
      {TRAILS.map((seconds) => (
        <option key={seconds} value={seconds}>
          {seconds === 0 ? 'Full trail' : `Trail ${seconds} s`}
        </option>
      ))}
    </select>
  );
}
