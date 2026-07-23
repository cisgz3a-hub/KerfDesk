// JobControls — Machine-rail setup, detailed run status, overrides, and progress.
// Canonical live-job actions live in the App-shell LiveMotionBar (ADR-207).

import { progress } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { describeControllerOperation } from '../state/laser-controller-operation';
import { describeAutofocusResult, useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { useCameraStore } from '../state/camera-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { jobTimeNoun } from '../machine/machine-labels';
import {
  actionGridStyle,
  containerStyle,
  framedRunStatusStyle,
  gridFullRowStyle,
  primaryActionStyle,
  progressContainerStyle,
  progressFillStyle,
  progressLabelStyle,
  sectionCaptionStyle,
} from './JobControls.styles';
import { JobPlacementControls } from './JobPlacementControls';
import { OriginRow } from './OriginRow';
import { ControllerOperationControls, MotionControls, RunningControls } from './JobRunControls';
import { OverrideControls } from './OverrideControls';
import { AccessoryResetControls } from './AccessoryResetControls';
import { IslandFillRecoveryAction } from './IslandFillRecoveryAction';
import { CheckpointResumeBanner } from './CheckpointResumeBanner';
import { StartFromLineControl } from './StartFromLineControl';
import { useFrameAction } from './use-frame-action';
import { useJobEstimate } from './use-job-estimate';
import { NoHomingPositionGuide } from './NoHomingPositionGuide';
import { StartBlockerNotice } from './StartBlockerNotice';
import { RunAgainControl } from './RunAgainControl';
import { framedRunReadinessIssue } from './framed-run-readiness';
import { ExecutionArchivePanel } from './ExecutionArchivePanel';
import { EstimateBadge, startJobTitle } from './JobEstimatePresentation';

type Props = {
  readonly disabled: boolean;
  readonly onConfigureAutofocus?: () => void;
  readonly onConfigureHoming?: () => void;
  readonly onStartJob: () => void;
};

// Both setup entries are optional so bare <JobControls> renders standalone;
// resolving them here keeps the branches out of the component body.
function configureCallbacks(props: Props): {
  readonly autofocus: () => void;
  readonly homing: () => void;
} {
  return {
    autofocus: props.onConfigureAutofocus ?? doNothing,
    homing: props.onConfigureHoming ?? doNothing,
  };
}

export function JobControls(props: Props): JSX.Element {
  const { disabled, onStartJob } = props;
  const configure = configureCallbacks(props);
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
  // needs an explicit Abort. The Live Motion bar remains mounted through that 'done'
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
  // Maintainer-directed rail order (ADR-225, amended 2026-07-17): origin
  // directly under the jog pad, job actions next so Start/Frame stay above the
  // fold on short windows, placement (a set-once compile setting that the Job
  // Review dialog re-shows at Start, ADR-224) below them, and the
  // hand-positioning guide last as a fallback.
  return (
    <div style={containerStyle}>
      <OriginRow disabled={disabled} streaming={controlsBusy} />
      <span style={sectionCaptionStyle}>Job</span>
      <SetupRow
        disabled={disabled}
        streaming={controlsBusy}
        onConfigureAutofocus={configure.autofocus}
        onConfigureHoming={configure.homing}
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
      <IslandFillRecoveryAction streaming={controlsBusy} />
      <CheckpointResumeBanner busy={controlsBusy} />
      <RunAgainControl disabled={disabled} busy={controlsBusy} />
      <ExecutionArchivePanel />
      <StartFromLineControl disabled={disabled} busy={controlsBusy} machineKind={machineKind} />
      <NoHomingPositionGuide disabled={disabled} streaming={controlsBusy} />
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

function useSetupRowModel(props: { readonly disabled: boolean; readonly streaming: boolean }) {
  const onFrame = useFrameAction();
  const onAutofocus = useAutofocusAction();
  // A permit can become stale from an artwork, scope, placement, controller,
  // or camera change. Subscribe to all three owning stores so the status text
  // changes immediately; Start repeats the same comparison at handoff.
  const app = useStore();
  const laser = useLaserStore();
  const camera = useCameraStore();
  // The resolved rotary-raster policy is part of the framed environment but
  // lives outside the app store, so subscribe explicitly for immediate expiry.
  useExperimentalLaserFeatures((s) => s.features.rotaryRaster);
  const autofocusCommand = useStore((s) => s.project.device.autofocusCommand);
  // ADR-101 §5 (provisional): auto-focus is a laser focus routine; it hides
  // on a router. The CNC Z-zeroing flow arrives as its own H.7 surface.
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  const home = useLaserStore((s) => s.home);
  const estimate = useJobEstimate();
  const busy = props.disabled || props.streaming;
  const framedRunIssue = framedRunReadinessIssue(laser.framedRun, app, laser, camera);
  const framedReady = framedRunIssue === null;
  return {
    onFrame,
    onAutofocus,
    home,
    busy,
    homingEnabled,
    isCncMachine: machineKind === 'cnc',
    frameOperationActive: laser.motionOperation?.kind === 'frame',
    hasFramedRun: laser.framedRun !== null,
    framedRunIssue,
    framedReady,
    frameControl: frameControlProps(busy, laser.statusReport?.state),
    startLabel: framedReady ? 'Start framed job' : 'Set up & Frame',
    frameLabel: framedReady ? 'Frame again' : 'Frame job',
    startControl: startControlProps(
      busy,
      framedReady
        ? startJobTitle(estimate, jobTimeNoun(machineKind))
        : 'Prepare and review the exact job, then trace its full motion envelope with the tool off.',
    ),
    // No portable autofocus G-code exists, so an empty command becomes a
    // direct setup entry instead of a disabled control that leaves users
    // hunting for the vendor-specific command field.
    noAutofocus: autofocusCommand.trim() === '',
    estimate,
  };
}

function SetupRow(props: {
  readonly disabled: boolean;
  readonly streaming: boolean;
  readonly onConfigureAutofocus: () => void;
  readonly onConfigureHoming: () => void;
  readonly onStartJob: () => void;
}): JSX.Element {
  const {
    onFrame,
    onAutofocus,
    home,
    busy,
    homingEnabled,
    isCncMachine,
    frameOperationActive,
    hasFramedRun,
    framedRunIssue,
    framedReady,
    frameControl,
    startLabel,
    frameLabel,
    startControl,
    noAutofocus,
    estimate,
  } = useSetupRowModel(props);
  // Start leads the grid full-width; Frame pairs beside Home under it. Both
  // run-the-machine actions wear the light-green go look (maintainer request,
  // matching LightBurn's green Start), so "moves the head" reads at a glance.
  return (
    <>
      <div style={actionGridStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--go"
          style={primaryActionStyle}
          onClick={props.onStartJob}
          disabled={startControl.disabled}
          title={startControl.title}
        >
          {startLabel}
        </button>
        <button
          type="button"
          className="lf-btn lf-btn--go"
          onClick={onFrame}
          disabled={frameControl.disabled}
          title={frameControl.title}
        >
          {frameLabel}
        </button>
        <HomeButton
          onHome={() => void home()}
          onConfigureHoming={props.onConfigureHoming}
          busy={busy}
          streaming={props.streaming}
          homingEnabled={homingEnabled}
        />
        {!isCncMachine && (
          <AutofocusButton
            needsSetup={noAutofocus}
            busy={busy}
            streaming={props.streaming}
            onConfigure={props.onConfigureAutofocus}
            onRun={onAutofocus}
          />
        )}
      </div>
      <span role="status" style={framedRunStatusStyle} title={framedRunIssue ?? undefined}>
        {framedRunStatusText(frameOperationActive, framedReady, hasFramedRun, framedRunIssue)}
      </span>
      <EstimateBadge estimate={estimate} />
    </>
  );
}

function framedRunStatusText(
  frameOperationActive: boolean,
  framedReady: boolean,
  hasFramedRun: boolean,
  framedRunIssue: string | null,
): string {
  if (frameOperationActive) return 'Framing exact job…';
  if (framedReady) return 'Ready to start — framed job unchanged';
  if (!hasFramedRun) return 'Not framed — prepare and Frame this job first';
  return `Frame expired — ${framedRunIssue}`;
}

// A machine whose homing switches were never declared otherwise leaves a dead
// grey Home button with no way forward, so an unconfigured profile turns the
// button into its own setup entry — the same offer-the-fix shape auto-focus
// uses below.
function HomeButton(props: {
  readonly onHome: () => void;
  readonly onConfigureHoming: () => void;
  readonly busy: boolean;
  readonly streaming: boolean;
  readonly homingEnabled: boolean;
}): JSX.Element {
  if (!props.homingEnabled) {
    return (
      <button
        type="button"
        className="lf-btn"
        onClick={props.onConfigureHoming}
        disabled={props.streaming}
        title="Homing is off for this machine. Open Machine Setup to turn on $H homing."
      >
        Set up homing
      </button>
    );
  }
  return (
    <button
      type="button"
      className="lf-btn"
      onClick={props.onHome}
      disabled={props.busy}
      title="Send $H — home all axes"
    >
      Home
    </button>
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
      className="lf-btn"
      style={gridFullRowStyle}
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

type ControlButtonProps = {
  readonly disabled: boolean;
  readonly title: string;
};

function frameControlProps(busy: boolean, state: string | undefined): ControlButtonProps {
  const ready = state === 'Idle';
  return {
    disabled: busy || !ready,
    title: ready
      ? 'Review the exact job, then trace its full generated motion envelope with the tool off.'
      : frameBlockedTitle(state),
  };
}

function startControlProps(busy: boolean, fallbackTitle: string): ControlButtonProps {
  return {
    disabled: busy,
    title: fallbackTitle,
  };
}

function frameBlockedTitle(state: string | undefined): string {
  if (state === undefined) {
    return 'Wait for an Idle status report before framing.';
  }
  return `Machine must be Idle before framing (currently ${state}).`;
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
