// JobControls — Home + Start / Pause / Resume / Stop + progress bar.
// F-B3 (Home), F-B6 (Start), F-B7 (Pause/Resume), F-B8 (Stop), F-B11 (Progress).

import { useMemo } from 'react';
import { progress } from '../../core/controllers/grbl';
import {
  applyJobOrigin,
  compileJob,
  computeJobBounds,
  describeFramePreflightFailure,
  framePreflight,
  offsetJobBounds,
  USER_ORIGIN_JOB_PLACEMENT,
} from '../../core/job';
import { useStore } from '../state';
import { describeAutofocusResult, hasCustomOrigin, useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { estimateLiveJob, type LiveJobEstimate } from './live-job-estimate';
import { CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE } from './start-job-readiness';

const PAUSE_HOLD_SAFETY_MESSAGE =
  'Pause is feed hold only. Use Stop or physical E-stop if unsafe.';

type Props = {
  readonly disabled: boolean;
  readonly onStartJob: () => void;
};

export function JobControls({ disabled, onStartJob }: Props): JSX.Element {
  const streamer = useLaserStore((s) => s.streamer);
  const isStreaming = streamer !== null && streamer.status === 'streaming';
  const isPaused = streamer !== null && streamer.status === 'paused';
  return (
    <div style={containerStyle}>
      <SetupRow disabled={disabled} streaming={isStreaming || isPaused} onStartJob={onStartJob} />
      <OriginRow disabled={disabled} streaming={isStreaming || isPaused} />
      {(isStreaming || isPaused) && (
        <RunningControls isStreaming={isStreaming} isPaused={isPaused} />
      )}
      {streamer !== null && streamer.total > 0 && <ProgressBar streamer={streamer} />}
    </div>
  );
}

// F.3 — Set / Reset the work-coordinate origin to the current head
// position. See ADR-021. Two buttons:
//   - "Set origin here" sends G92 X0 Y0. Always enabled (subject to
//     `busy`) — the operator can re-set the origin whenever the head
//     is at a new corner.
//   - "Reset origin" sends G92.1. Only enabled when wcoCache shows a
//     non-trivial offset; disabled otherwise (nothing to clear).
function OriginRow(props: {
  readonly disabled: boolean;
  readonly streaming: boolean;
}): JSX.Element {
  const setOrigin = useLaserStore((s) => s.setOriginHere);
  const resetOrigin = useLaserStore((s) => s.resetOrigin);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const pushToast = useToastStore((s) => s.pushToast);
  const busy = props.disabled || props.streaming;
  const hasCustom = workOriginActive || hasCustomOrigin(wcoCache);
  // Toast on ack covers the WCO-frame latency gap — GRBL reports WCO
  // intermittently (every Nth status per `$10`), so the StatusDisplay
  // readout may take 1-30 frames (~0.25-7.5s) to update after a G92.
  // The toast gives instant feedback so the user doesn't re-click.
  const onSet = (): void => {
    void setOrigin().then(() => pushToast('Origin set to current head position (G92).', 'success'));
  };
  const onReset = (): void => {
    void resetOrigin().then(() =>
      pushToast('Work origin cleared — back to machine zero (G92.1).', 'success'),
    );
  };
  return (
    <div style={rowStyle}>
      <button
        type="button"
        onClick={onSet}
        disabled={busy}
        title="Declare the current head position as the workpiece (0, 0). Cleared on alarm or stop."
      >
        Set origin here
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={busy || !hasCustom}
        title={
          hasCustom
            ? 'Clear the custom work origin (G92.1) — coordinates return to machine zero.'
            : 'No custom origin active. Set one with "Set origin here" first.'
        }
      >
        Reset origin
      </button>
    </div>
  );
}

function SetupRow(props: {
  readonly disabled: boolean;
  readonly streaming: boolean;
  readonly onStartJob: () => void;
}): JSX.Element {
  const onFrame = useFrameAction();
  const onAutofocus = useAutofocusAction();
  const autofocusCommand = useStore((s) => s.project.device.autofocusCommand);
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  const home = useLaserStore((s) => s.home);
  const estimate = useJobEstimate();
  const busy = props.disabled || props.streaming;
  // Disabled when the command is empty — there's no portable autofocus
  // G-code (see DeviceProfile.autofocusCommand docs); shipping a default
  // we picked would break someone's machine, so the button is dark until
  // the user pastes their machine's command.
  const noAutofocus = autofocusCommand.trim() === '';
  return (
    <div style={rowStyle}>
      <button
        type="button"
        onClick={() => void home()}
        disabled={props.disabled || !homingEnabled}
        title={
          homingEnabled
            ? 'Send $H — home all axes'
            : 'Homing is disabled in Device settings. Enable "$H supported" first.'
        }
      >
        Home
      </button>
      <button
        type="button"
        onClick={onAutofocus}
        disabled={busy || noAutofocus}
        title={
          noAutofocus
            ? 'Set your machine’s autofocus command in Device settings below'
            : 'Run the autofocus command configured in Device settings'
        }
      >
        Auto-focus
      </button>
      <button type="button" onClick={onFrame} disabled={busy}>
        Frame
      </button>
      <button
        type="button"
        onClick={props.onStartJob}
        disabled={busy}
        title={startJobTitle(estimate)}
      >
        Start job
      </button>
      <EstimateBadge estimate={estimate} />
    </div>
  );
}

// Live ETA for the current scene + device settings. Huge vector traces
// intentionally report "too-large" so React render never runs the full
// compile/optimize/estimate pipeline on a main-thread hot path.
function useJobEstimate(): LiveJobEstimate {
  const project = useStore((s) => s.project);
  return useMemo(() => estimateLiveJob(project), [project]);
}

function startJobTitle(estimate: LiveJobEstimate): string {
  if (estimate.kind === 'estimated') {
    return `Estimated burn time: ${estimate.label} (excludes acceleration overhead)`;
  }
  if (estimate.kind === 'too-large') {
    return 'Large trace: live estimate paused for performance. Start still generates full G-code.';
  }
  return 'Enable Output on at least one layer to start a job';
}

function EstimateBadge({ estimate }: { readonly estimate: LiveJobEstimate }): JSX.Element | null {
  if (estimate.kind === 'estimated') return <span style={estimateStyle}>≈ {estimate.label}</span>;
  if (estimate.kind === 'too-large') {
    return (
      <span style={estimateStyle} title="Live estimate paused so large traces stay responsive.">
        large job
      </span>
    );
  }
  return null;
}

function RunningControls(props: {
  readonly isStreaming: boolean;
  readonly isPaused: boolean;
}): JSX.Element {
  const pauseJob = useLaserStore((s) => s.pauseJob);
  const resumeJob = useLaserStore((s) => s.resumeJob);
  const stopJob = useLaserStore((s) => s.stopJob);
  return (
    <div style={rowStyle}>
      {props.isStreaming && (
        <button type="button" onClick={() => void pauseJob()} title={PAUSE_HOLD_SAFETY_MESSAGE}>
          Pause
        </button>
      )}
      {props.isPaused && (
        <button type="button" onClick={() => void resumeJob()}>
          Resume
        </button>
      )}
      <button type="button" onClick={() => void stopJob()} style={stopBtnStyle}>
        Stop
      </button>
      <span style={runningSafetyStyle}>{PAUSE_HOLD_SAFETY_MESSAGE}</span>
    </div>
  );
}

function ProgressBar({
  streamer,
}: {
  readonly streamer: NonNullable<ReturnType<typeof useLaserStore.getState>['streamer']>;
}): JSX.Element {
  return (
    <div style={progressContainerStyle}>
      <div style={{ ...progressFillStyle, width: `${Math.round(progress(streamer) * 100)}%` }} />
      <div style={progressLabelStyle}>
        {streamer.completed} / {streamer.total} lines
      </div>
    </div>
  );
}

function useFrameAction(): () => void {
  const project = useStore((s) => s.project);
  const frame = useLaserStore((s) => s.frame);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const pushToast = useToastStore((s) => s.pushToast);
  return () => {
    const compiled = compileJob(project.scene, project.device);
    const useUserOrigin = workOriginActive || hasCustomOrigin(wcoCache);
    const job = useUserOrigin ? applyJobOrigin(compiled, USER_ORIGIN_JOB_PLACEMENT) : compiled;
    const bounds = computeJobBounds(job);
    if (bounds === null) {
      pushToast('Nothing to frame — enable Output on at least one layer.', 'warning');
      return;
    }
    if (useUserOrigin && wcoCache === null) {
      pushToast(CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE, 'error');
      return;
    }
    // Refuse to drive the head off-bed. The Falcon (and most diode
    // lasers) ship with $20=0, so any X/Y past the soft-limits skips
    // steps mechanically — the operator hears grinding and the trace
    // collapses to a sideways line because the axis that hit the stop
    // can't keep up. Better to refuse here with a clear instruction.
    const preflightBounds =
      useUserOrigin && wcoCache !== null ? offsetJobBounds(bounds, wcoCache) : bounds;
    const pre = framePreflight(preflightBounds, project.device);
    if (pre.kind === 'out-of-bounds') {
      pushToast(describeFramePreflightFailure(pre), 'error');
      return;
    }
    // Frame uses its own dedicated feed so changing layer / cut speed
    // doesn't slow the framing pass. Capped at maxFeed so we never
    // command past the machine's hardware rate. See ADR / device-profile
    // notes on framingFeedMmPerMin.
    const feed = Math.min(project.device.framingFeedMmPerMin, project.device.maxFeed);
    void frame(bounds, feed);
  };
}

function useAutofocusAction(): () => void {
  const autofocusCommand = useStore((s) => s.project.device.autofocusCommand);
  const autofocus = useLaserStore((s) => s.autofocus);
  const pushToast = useToastStore((s) => s.pushToast);
  return () => {
    if (autofocusCommand.trim() === '') {
      pushToast('No autofocus command configured. Set it in Device settings.', 'warning');
      return;
    }
    void autofocus(autofocusCommand).then((result) => {
      const t = describeAutofocusResult(result);
      pushToast(t.message, t.variant);
    });
  };
}

const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6 };
const stopBtnStyle: React.CSSProperties = { background: '#c62828', color: '#fff' };
const progressContainerStyle: React.CSSProperties = {
  position: 'relative',
  background: '#e0e0e0',
  height: 18,
  borderRadius: 3,
  overflow: 'hidden',
};
const progressFillStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  background: '#1976d2',
  transition: 'width 100ms linear',
};
const progressLabelStyle: React.CSSProperties = {
  position: 'relative',
  textAlign: 'center',
  fontSize: 11,
  lineHeight: '18px',
  color: '#111',
  textShadow: '0 0 2px #fff',
};
const estimateStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#666',
  alignSelf: 'center',
  fontVariantNumeric: 'tabular-nums',
};
const runningSafetyStyle: React.CSSProperties = {
  color: '#fbbf24',
  fontSize: 12,
  lineHeight: 1.3,
};
