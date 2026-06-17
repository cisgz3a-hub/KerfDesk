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
  frameBoundsSignature,
  framePreflight,
  type JobBounds,
  offsetJobBounds,
} from '../../core/job';
import { prepareOutput } from '../../io/gcode';
import { resolveJobPlacement, trustedMotionOffsetForPreflight } from '../job-placement';
import { currentOutputScope, useStore } from '../state';
import { describeAutofocusResult, useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  containerStyle,
  estimateStyle,
  progressContainerStyle,
  progressFillStyle,
  progressLabelStyle,
  rowStyle,
  runningSafetyStyle,
  stopBtnStyle,
} from './JobControls.styles';
import { JobPlacementControls } from './JobPlacementControls';
import { OriginRow } from './OriginRow';
import { type LiveJobEstimate } from './live-job-estimate';
import { useJobEstimate } from './use-job-estimate';

const PAUSE_HOLD_SAFETY_MESSAGE = 'Pause is feed hold only. Use Stop or physical E-stop if unsafe.';

type Props = {
  readonly disabled: boolean;
  readonly onStartJob: () => void;
};

export function JobControls({ disabled, onStartJob }: Props): JSX.Element {
  const streamer = useLaserStore((s) => s.streamer);
  const status = streamer?.status;
  const isStreaming = status === 'streaming';
  const isPaused = status === 'paused';
  // 'done' and 'errored' both keep the recovery controls (chiefly Stop)
  // mounted. A finished job stays active (isActiveJob) until a later Idle status
  // clears the streamer — laser-store-helpers keeps 'done' busy so the user
  // can't jog into a head still physically finishing motion — and an errored job
  // needs an explicit Stop. Mounting Stop through the 'done' window means a job
  // whose Idle report is delayed or never arrives still has an in-app escape
  // instead of forcing a disconnect/reconnect.
  const jobNeedsRecovery = isStreaming || isPaused || status === 'errored' || status === 'done';
  const motionOperation = useLaserStore((s) => s.motionOperation);
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
      const fallbackBounds = rasterBudgetFallbackBounds(prepared.preflight, frameBounds);
      if (fallbackBounds !== null) {
        dispatchFrameIfSafe(frame, pushToast, fallbackBounds, fallbackBounds, placement, project);
        return;
      }
      pushToast(
        prepared.preflight.issues[0]?.message ?? 'Raster job is too large to frame.',
        'error',
      );
      return;
    }
    const bounds = computeJobBounds(prepared.job, project.device);
    if (bounds === null) {
      pushToast('Nothing to frame — enable Output on at least one layer.', 'warning');
      return;
    }
    const motionBounds = computeJobMotionBounds(prepared.job, project.device) ?? bounds;
    // Refuse to drive the head off-bed. The Falcon (and most diode
    // lasers) ship with $20=0, so any X/Y past the soft-limits skips
    // steps mechanically — the operator hears grinding and the trace
    // collapses to a sideways line because the axis that hit the stop
    // can't keep up. Better to refuse here with a clear instruction.
    dispatchFrameIfSafe(frame, pushToast, bounds, motionBounds, placement, project);
  };
}

function rasterBudgetFallbackBounds(
  preflight: Extract<ReturnType<typeof prepareOutput>, { readonly ok: false }>['preflight'],
  frameBounds: JobBounds | null,
): JobBounds | null {
  const rasterOnly =
    preflight.issues.length > 0 &&
    preflight.issues.every((issue) => issue.code === 'raster-too-large');
  return rasterOnly ? frameBounds : null;
}

function dispatchFrameIfSafe(
  frame: (bounds: JobBounds, feed: number) => Promise<void>,
  pushToast: (message: string, variant: 'error') => void,
  bounds: JobBounds,
  motionBounds: JobBounds,
  placement: Extract<ReturnType<typeof resolveJobPlacement>, { readonly ok: true }>,
  project: ReturnType<typeof useStore.getState>['project'],
): void {
  const motionOffset = trustedMotionOffsetForPreflight(project.device, placement);
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
  const feed = Math.min(project.device.framingFeedMmPerMin, project.device.maxFeed);
  const isVerifiedOrigin = placement.jobOrigin?.startFrom === 'verified-origin';
  void frame(bounds, feed)
    .then(() => {
      // Record the Verified Frame on a clean dispatch. The frame motion is still
      // running, but Start is separately gated on Idle + no-alarm, so a frame
      // that is mid-flight, hit a limit (alarm), or was cancelled can never
      // authorize a burn from this record (ADR-053 P2).
      if (!isVerifiedOrigin) return;
      const laser = useLaserStore.getState();
      laser.markFrameVerified({
        boundsSignature: frameBoundsSignature(bounds),
        wco: laser.wcoCache,
        workOriginActive: laser.workOriginActive,
      });
    })
    .catch(() => undefined);
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
  if (pre.kind === 'out-of-bounds') {
    return `${describeFramePreflightFailure(pre)} Generated motion includes overscan; move the artwork farther from the bed edge or reduce overscan after a test burn.`;
  }
  if (pre.kind === 'no-go-zone') {
    return `Cannot frame: generated motion crosses no-go zone "${pre.zoneName}".`;
  }
  return null;
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
