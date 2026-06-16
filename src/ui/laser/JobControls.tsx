// JobControls — Home + Start / Pause / Resume / Stop + progress bar.
// F-B3 (Home), F-B6 (Start), F-B7 (Pause/Resume), F-B8 (Stop), F-B11 (Progress).

import { progress } from '../../core/controllers/grbl';
import type { DeviceProfile } from '../../core/devices';
import type { MotionBoundsOffset } from '../../core/invariants';
import {
  computeFrameBounds,
  computeJobBounds,
  computeJobMotionBounds,
  describeFramePreflightFailure,
  framePreflight,
  type JobBounds,
  offsetJobBounds,
} from '../../core/job';
import { prepareOutput } from '../../io/gcode';
import { resolveJobPlacement, trustedMotionOffsetForPreflight } from '../job-placement';
import { currentOutputScope, useStore } from '../state';
import { describeAutofocusResult, hasCustomOrigin, useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { JobPlacementControls } from './JobPlacementControls';
import { type LiveJobEstimate } from './live-job-estimate';
import { useJobEstimate } from './use-job-estimate';

const PAUSE_HOLD_SAFETY_MESSAGE = 'Pause is feed hold only. Use Stop or physical E-stop if unsafe.';

type Props = {
  readonly disabled: boolean;
  readonly onStartJob: () => void;
};

export function JobControls({ disabled, onStartJob }: Props): JSX.Element {
  const streamer = useLaserStore((s) => s.streamer);
  const isStreaming = streamer !== null && streamer.status === 'streaming';
  const isPaused = streamer !== null && streamer.status === 'paused';
  const isErrored = streamer !== null && streamer.status === 'errored';
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const jobNeedsRecovery = isStreaming || isPaused || isErrored;
  const motionBusy = motionOperation !== null;
  const controlsBusy = jobNeedsRecovery || motionBusy;
  return (
    <div style={containerStyle}>
      <JobPlacementControls disabled={disabled} streaming={controlsBusy} />
      <OriginRow disabled={disabled} streaming={controlsBusy} />
      <SetupRow disabled={disabled} streaming={controlsBusy} onStartJob={onStartJob} />
      {motionOperation !== null && <MotionControls operationKind={motionOperation.kind} />}
      {jobNeedsRecovery && <RunningControls isStreaming={isStreaming} isPaused={isPaused} />}
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
  const setJobPlacement = useStore((s) => s.setJobPlacement);
  const pushToast = useToastStore((s) => s.pushToast);
  const busy = props.disabled || props.streaming;
  const hasCustom = workOriginActive || hasCustomOrigin(wcoCache);
  // Toast on ack covers the WCO-frame latency gap — GRBL reports WCO
  // intermittently (every Nth status per `$10`), so the StatusDisplay
  // readout may take 1-30 frames (~0.25-7.5s) to update after a G92.
  // The toast gives instant feedback so the user doesn't re-click.
  const onSet = (): void => {
    void setOrigin().then(() => {
      setJobPlacement({ startFrom: 'user-origin' });
      pushToast('Origin set to current head position (G92).', 'success');
    });
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
  const statusReport = useLaserStore((s) => s.statusReport);
  const home = useLaserStore((s) => s.home);
  const estimate = useJobEstimate();
  const busy = props.disabled || props.streaming;
  const frameReady = statusReport?.state === 'Idle';
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
        disabled={busy || !homingEnabled}
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
      <button
        type="button"
        onClick={onFrame}
        disabled={busy || !frameReady}
        title={
          frameReady
            ? "Trace the job's bounding box with the laser off to check placement"
            : frameBlockedTitle(statusReport?.state)
        }
      >
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

function frameBlockedTitle(state: string | undefined): string {
  if (state === undefined) {
    return 'Wait for an Idle status report before framing.';
  }
  return `Machine must be Idle before framing (currently ${state}).`;
}

function startJobTitle(estimate: LiveJobEstimate): string {
  if (estimate.kind === 'estimated') {
    return `Estimated burn time: ${estimate.label}`;
  }
  if (estimate.kind === 'too-large') {
    return 'Large job: Start will block until you reduce the artwork size or lower the raster settings.';
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
        <button
          type="button"
          onClick={() => void pauseJob().catch(() => undefined)}
          title={PAUSE_HOLD_SAFETY_MESSAGE}
        >
          Pause
        </button>
      )}
      {props.isPaused && (
        <button
          type="button"
          onClick={() => void resumeJob().catch(() => undefined)}
          title="Release the feed hold and continue the job"
        >
          Resume
        </button>
      )}
      <button
        type="button"
        onClick={() => void stopJob().catch(() => undefined)}
        style={stopBtnStyle}
        title="Soft-reset the controller and halt the job (Ctrl+.)"
      >
        Stop
      </button>
      <span style={runningSafetyStyle}>{PAUSE_HOLD_SAFETY_MESSAGE}</span>
    </div>
  );
}

function MotionControls(props: { readonly operationKind: 'frame' | 'jog' }): JSX.Element {
  const cancelJog = useLaserStore((s) => s.cancelJog);
  const label = props.operationKind === 'frame' ? 'Cancel frame' : 'Cancel jog';
  return (
    <div style={rowStyle}>
      <button
        type="button"
        onClick={() => void cancelJog().catch(() => undefined)}
        title="Cancel the active framing or jog motion. Use physical E-stop if unsafe."
      >
        {label}
      </button>
      <span style={runningSafetyStyle}>Uses GRBL jog cancel. Use physical E-stop if unsafe.</span>
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
  const frame = useLaserStore((s) => s.frame);
  const statusReport = useLaserStore((s) => s.statusReport);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const pushToast = useToastStore((s) => s.pushToast);
  return () => {
    // Click-only consumer: read project/placement at call time instead of
    // subscribing — a render-per-mousemove for a button handler (H16).
    const app = useStore.getState();
    const { project, jobPlacement } = app;
    const outputScope = currentOutputScope(app);
    const placement = resolveJobPlacement(jobPlacement, {
      statusReport,
      workOriginActive,
      wcoCache,
    });
    if (!placement.ok) {
      pushToast(placement.messages[0] ?? 'Job origin cannot be resolved.', 'error');
      return;
    }
    const frameBounds = computeFrameBounds(
      project.scene,
      project.device,
      placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin },
    );
    const prepared = prepareOutput(project, {
      ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
      outputScope,
    });
    if (!prepared.ok) {
      if (isRasterBudgetOnlyFailure(prepared.preflight) && frameBounds !== null) {
        const motionOffset = trustedMotionOffsetForPreflight(project.device, placement);
        const motionIssue = describeFrameMotionPreflightIssue(
          frameBounds,
          motionOffset,
          placement.jobOrigin !== undefined,
          project.device,
        );
        if (motionIssue !== null) {
          pushToast(motionIssue, 'error');
          return;
        }
        const feed = Math.min(project.device.framingFeedMmPerMin, project.device.maxFeed);
        void frame(frameBounds, feed);
        return;
      }
      pushToast(
        prepared.preflight.issues[0]?.message ?? 'Raster job is too large to frame.',
        'error',
      );
      return;
    }
    const bounds = computeJobBounds(prepared.job);
    if (bounds === null) {
      pushToast('Nothing to frame — enable Output on at least one layer.', 'warning');
      return;
    }
    const motionBounds = computeJobMotionBounds(prepared.job) ?? bounds;
    const motionOffset = trustedMotionOffsetForPreflight(project.device, placement);
    // Refuse to drive the head off-bed. The Falcon (and most diode
    // lasers) ship with $20=0, so any X/Y past the soft-limits skips
    // steps mechanically — the operator hears grinding and the trace
    // collapses to a sideways line because the axis that hit the stop
    // can't keep up. Better to refuse here with a clear instruction.
    const motionIssue = describeFrameMotionPreflightIssue(
      motionBounds,
      motionOffset,
      placement.jobOrigin !== undefined,
      project.device,
    );
    if (motionIssue !== null) {
      pushToast(motionIssue, 'error');
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

function isRasterBudgetOnlyFailure(
  preflight: Extract<ReturnType<typeof prepareOutput>, { readonly ok: false }>['preflight'],
): boolean {
  return (
    preflight.issues.length > 0 &&
    preflight.issues.every((issue) => issue.code === 'raster-too-large')
  );
}

function describeFrameMotionPreflightIssue(
  motionBounds: JobBounds,
  motionOffset: MotionBoundsOffset | undefined,
  hasRelativeOrigin: boolean,
  device: DeviceProfile,
): string | null {
  if (motionOffset === undefined && hasRelativeOrigin) {
    return describeRelativeMotionTooLarge(motionBounds, device);
  }
  const preflightBounds =
    motionOffset === undefined ? motionBounds : offsetJobBounds(motionBounds, motionOffset);
  const pre = framePreflight(preflightBounds, device);
  return pre.kind === 'out-of-bounds'
    ? `${describeFramePreflightFailure(pre)} Generated motion includes overscan; move the artwork farther from the bed edge or reduce overscan after a test burn.`
    : null;
}

function describeRelativeMotionTooLarge(
  bounds: JobBounds,
  device: { readonly bedWidth: number; readonly bedHeight: number },
): string | null {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= device.bedWidth && height <= device.bedHeight) return null;
  const parts: string[] = [];
  if (width > device.bedWidth) parts.push(`X span ${width.toFixed(1)} mm`);
  if (height > device.bedHeight) parts.push(`Y span ${height.toFixed(1)} mm`);
  return `Cannot frame: generated motion (${parts.join(', ')}) is larger than the ${device.bedWidth}×${device.bedHeight} mm bed. Scale the artwork down or reduce overscan.`;
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
const stopBtnStyle: React.CSSProperties = {
  background: 'var(--lf-danger)',
  color: 'var(--lf-on-fill)',
};
const progressContainerStyle: React.CSSProperties = {
  position: 'relative',
  background: 'var(--lf-bg-input)',
  height: 18,
  borderRadius: 3,
  overflow: 'hidden',
};
const progressFillStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  background: 'var(--lf-accent)',
  transition: 'width 100ms linear',
};
const progressLabelStyle: React.CSSProperties = {
  position: 'relative',
  textAlign: 'center',
  fontSize: 11,
  lineHeight: '18px',
  color: 'var(--lf-text)',
};
const estimateStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  alignSelf: 'center',
  fontVariantNumeric: 'tabular-nums',
};
const runningSafetyStyle: React.CSSProperties = {
  color: 'var(--lf-warning-fg)',
  fontSize: 12,
  lineHeight: 1.3,
};
