// JobControls — Home + Start / Pause / Resume / Stop + progress bar.
// F-B3 (Home), F-B6 (Start), F-B7 (Pause/Resume), F-B8 (Stop), F-B11 (Progress).

import { progress } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { describeControllerOperation } from '../state/laser-controller-operation';
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
import { IslandFillRecoveryAction } from './IslandFillRecoveryAction';
import { type LiveJobEstimate } from './live-job-estimate';
import { useFrameAction } from './use-frame-action';
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
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const motionBusy = motionOperation !== null;
  const controlsBusy = jobNeedsRecovery || motionBusy || controllerOperation !== null;
  return (
    <div style={containerStyle}>
      <JobPlacementControls disabled={disabled} streaming={controlsBusy} />
      <OriginRow disabled={disabled} streaming={controlsBusy} />
      <SetupRow disabled={disabled} streaming={controlsBusy} onStartJob={onStartJob} />
      {motionOperation !== null && <MotionControls operationKind={motionOperation.kind} />}
      {controllerOperation !== null && (
        <ControllerOperationControls label={describeControllerOperation(controllerOperation)} />
      )}
      <IslandFillRecoveryAction streaming={controlsBusy} />
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
  // ADR-100 §5 (provisional): auto-focus is a laser focus routine; it hides
  // on a router. The CNC Z-zeroing flow arrives as its own H.7 surface.
  const isCncMachine = useStore((s) => s.project.machine?.kind === 'cnc');
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
      {!isCncMachine && (
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
      )}
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

function ControllerOperationControls({ label }: { readonly label: string }): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={runningSafetyStyle}>{label}</span>
    </div>
  );
}

function ProgressBar({
  streamer,
}: {
  readonly streamer: NonNullable<ReturnType<typeof useLaserStore.getState>['streamer']>;
}): JSX.Element {
  const display = describeProgressDisplay(streamer);
  return (
    <div style={progressContainerStyle} title={display.title}>
      <div
        data-testid="job-progress-fill"
        style={{ ...progressFillStyle, width: `${display.percent}%` }}
      />
      <div style={progressLabelStyle}>{display.label}</div>
    </div>
  );
}

function describeProgressDisplay(
  streamer: NonNullable<ReturnType<typeof useLaserStore.getState>['streamer']>,
): { readonly percent: number; readonly label: string; readonly title: string } {
  const lineText = `${streamer.completed} / ${streamer.total}`;
  if (streamer.status === 'done') {
    return {
      percent: 99,
      label: `Machine finishing (${lineText} sent)`,
      title:
        'GRBL has acknowledged every G-code line, but KerfDesk is waiting for Idle before marking the job complete.',
    };
  }
  return {
    percent: Math.round(progress(streamer) * 100),
    label: `${lineText} lines`,
    title: 'G-code lines acknowledged by the controller.',
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
