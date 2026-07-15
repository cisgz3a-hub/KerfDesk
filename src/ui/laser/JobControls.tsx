// JobControls — Machine-rail setup, detailed run status, overrides, and progress.
// Canonical live-job actions live in the App-shell LiveMotionBar (ADR-207).

import { progress } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { describeControllerOperation } from '../state/laser-controller-operation';
import { describeAutofocusResult, useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { jobTimeNoun } from '../machine/machine-labels';
import {
  containerStyle,
  estimateStyle,
  progressContainerStyle,
  progressFillStyle,
  progressLabelStyle,
  rowStyle,
} from './JobControls.styles';
import { JobPlacementControls } from './JobPlacementControls';
import { OriginRow } from './OriginRow';
import { ControllerOperationControls, MotionControls, RunningControls } from './JobRunControls';
import { OverrideControls } from './OverrideControls';
import { AccessoryResetControls } from './AccessoryResetControls';
import { IslandFillRecoveryAction } from './IslandFillRecoveryAction';
import { CheckpointResumeBanner } from './CheckpointResumeBanner';
import { StartFromLineControl } from './StartFromLineControl';
import { type LiveJobEstimate } from './live-job-estimate';
import { useFrameAction } from './use-frame-action';
import { useJobEstimate } from './use-job-estimate';
import { NoHomingPositionGuide } from './NoHomingPositionGuide';
import { StartBlockerNotice } from './StartBlockerNotice';
import { RunAgainControl } from './RunAgainControl';

type Props = {
  readonly disabled: boolean;
  /** Disables only Start while controller qualification is incomplete. Other
   * safe setup controls remain available so the operator can recover. */
  readonly startDisabledReason?: string | null;
  readonly onConfigureAutofocus?: () => void;
  readonly onStartJob: () => void;
};

export function JobControls({
  disabled,
  startDisabledReason,
  onConfigureAutofocus = doNothing,
  onStartJob,
}: Props): JSX.Element {
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const streamer = useLaserStore((s) => s.streamer);
  const status = streamer?.status;
  const isStreaming = status === 'streaming';
  const isPaused = status === 'paused';
  const isToolChange = status === 'tool-change';
  // 'done' and 'errored' both keep the rail's recovery status mounted. The
  // App-shell LiveMotionBar independently owns Abort. A finished job stays active
  // (isActiveJob) until a later Idle status
  // clears the streamer — laser-store-helpers keeps 'done' busy so the user
  // can't jog into a head still physically finishing motion — and an errored job
  // needs an explicit Abort. The top bar remains mounted through that 'done'
  // window, and through a tool-change hold, independently of this rail.
  const jobNeedsRecovery =
    status !== undefined &&
    ['streaming', 'paused', 'tool-change', 'errored', 'done'].includes(status);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const hasOverrides = useLaserStore((s) => s.capabilities.overrides);
  const ovCache = useLaserStore((s) => s.ovCache);
  const accessoryCache = useLaserStore((s) => s.accessoryCache ?? null);
  const controllerState = useLaserStore((s) => s.statusReport?.state ?? null);
  const motionBusy = motionOperation !== null;
  const controlsBusy = jobNeedsRecovery || motionBusy || controllerOperation !== null;
  const showIdleOverrideReset = shouldShowIdleOverrideReset(controlsBusy, hasOverrides, ovCache);
  return (
    <div style={containerStyle}>
      <SetupRow
        disabled={disabled}
        streaming={controlsBusy}
        startDisabledReason={startDisabledReason}
        onConfigureAutofocus={onConfigureAutofocus}
        onStartJob={onStartJob}
      />
      <StartBlockerNotice />
      <AccessoryResetControls
        accessories={accessoryCache}
        controlsBusy={controlsBusy}
        controllerState={controllerState}
        disabled={disabled}
        machineKind={machineKind}
      />
      {showIdleOverrideReset && <OverrideControls />}
      {motionOperation !== null && <MotionControls operationKind={motionOperation.kind} />}
      {controllerOperation !== null && (
        <ControllerOperationControls label={describeControllerOperation(controllerOperation)} />
      )}
      {jobNeedsRecovery && (
        <RunningControls
          isStreaming={isStreaming}
          isPaused={isPaused}
          isToolChange={isToolChange}
        />
      )}
      <JobPlacementControls streaming={controlsBusy} />
      <NoHomingPositionGuide disabled={disabled} streaming={controlsBusy} />
      <OriginRow disabled={disabled} streaming={controlsBusy} />
      <IslandFillRecoveryAction streaming={controlsBusy} />
      <CheckpointResumeBanner busy={controlsBusy} />
      <RunAgainControl disabled={disabled} busy={controlsBusy} />
      <StartFromLineControl disabled={disabled} busy={controlsBusy} machineKind={machineKind} />
      {streamer !== null && streamer.total > 0 && <ProgressBar streamer={streamer} />}
    </div>
  );
}

function hasNonDefaultOverrides(overrides: {
  feed: number;
  rapid: number;
  spindle: number;
}): boolean {
  return overrides.feed !== 100 || overrides.rapid !== 100 || overrides.spindle !== 100;
}

function shouldShowIdleOverrideReset(
  controlsBusy: boolean,
  hasOverrides: boolean,
  overrides: { feed: number; rapid: number; spindle: number } | null,
): boolean {
  return !controlsBusy && hasOverrides && overrides !== null && hasNonDefaultOverrides(overrides);
}

function SetupRow(props: {
  readonly disabled: boolean;
  readonly streaming: boolean;
  readonly startDisabledReason: string | null | undefined;
  readonly onConfigureAutofocus: () => void;
  readonly onStartJob: () => void;
}): JSX.Element {
  const onFrame = useFrameAction();
  const onAutofocus = useAutofocusAction();
  const autofocusCommand = useStore((s) => s.project.device.autofocusCommand);
  // ADR-101 §5 (provisional): auto-focus is a laser focus routine; it hides
  // on a router. The CNC Z-zeroing flow arrives as its own H.7 surface.
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const isCncMachine = machineKind === 'cnc';
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  const statusReport = useLaserStore((s) => s.statusReport);
  const home = useLaserStore((s) => s.home);
  const estimate = useJobEstimate();
  const busy = props.disabled || props.streaming;
  const frameReady = statusReport?.state === 'Idle';
  // No portable autofocus G-code exists, so an empty command becomes a direct
  // setup entry instead of a disabled control that leaves users hunting for
  // the vendor-specific command field.
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
        <AutofocusButton
          needsSetup={noAutofocus}
          busy={busy}
          streaming={props.streaming}
          onConfigure={props.onConfigureAutofocus}
          onRun={onAutofocus}
        />
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
        disabled={busy || props.startDisabledReason != null}
        title={props.startDisabledReason ?? startJobTitle(estimate, jobTimeNoun(machineKind))}
      >
        Start job
      </button>
      <EstimateBadge estimate={estimate} />
    </div>
  );
}

function AutofocusButton(props: {
  readonly needsSetup: boolean;
  readonly busy: boolean;
  readonly streaming: boolean;
  readonly onConfigure: () => void;
  readonly onRun: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.needsSetup ? props.onConfigure : props.onRun}
      disabled={props.needsSetup ? props.streaming : props.busy}
      title={
        props.needsSetup
          ? 'Open Machine Setup at Auto-focus setup.'
          : 'Run the auto-focus command configured in Machine Setup.'
      }
    >
      {props.needsSetup ? 'Set up auto-focus' : 'Auto-focus'}
    </button>
  );
}

const doNothing = (): void => undefined;

function frameBlockedTitle(state: string | undefined): string {
  if (state === undefined) {
    return 'Wait for an Idle status report before framing.';
  }
  return `Machine must be Idle before framing (currently ${state}).`;
}

function startJobTitle(estimate: LiveJobEstimate, timeNoun: string): string {
  if (estimate.kind === 'estimated') {
    return `Estimated ${timeNoun} time: ${estimate.label}`;
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
