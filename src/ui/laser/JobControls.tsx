// JobControls — Machine-rail setup, detailed run status, overrides, and progress.
// Canonical live-job actions live in the App-shell LiveMotionBar (ADR-207).

import { TutorialButton } from '../tutorials/TutorialButton';
import { useStore } from '../state';
import { describeControllerOperation } from '../state/laser-controller-operation';
import { useLaserStore } from '../state/laser-store';
import {
  actionGridStyle,
  containerStyle,
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
import { SecondPassControl } from './second-pass/SecondPassControl';
import { StartFromLineControl } from './StartFromLineControl';
import { NoHomingPositionGuide } from './NoHomingPositionGuide';
import { StartBlockerNotice } from './StartBlockerNotice';
import { RunAgainControl } from './RunAgainControl';
import { ExecutionArchivePanel } from './ExecutionArchivePanel';
import { JobActionControls } from './JobActionControls';
import { JobSetupControls } from './JobSetupControls';
import { jobControlsBusy, jobNeedsRecovery } from './job-controls-busy';
import { CollapsibleRailSection } from './CollapsibleRailSection';
import {
  streamProgressPercent,
  useLiveStreamProgress,
  type LiveStreamProgress,
} from './use-live-stream-progress';

type Props = {
  readonly disabled: boolean;
  readonly onConfigureAutofocus?: () => void;
  readonly onConfigureHoming?: () => void;
  readonly onStartJob: () => void;
  readonly dockedJobActions?: boolean;
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
  // By value and throttled: the streamer object is replaced on every
  // acknowledgement, and this rail only shows a status and a line count
  // (ADR-333).
  const streamProgress = useLiveStreamProgress();
  const status = streamProgress.status ?? undefined;
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
  const needsRecovery = jobNeedsRecovery(status);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const hasOverrides = useLaserStore((s) => s.capabilities.overrides);
  const ovCache = useLaserStore((s) => s.ovCache);
  const accessoryCache = useLaserStore((s) => s.accessoryCache ?? null);
  const controllerState = useLaserStore((s) => s.statusReport?.state ?? null);
  const controlsBusy = jobControlsBusy(status, motionOperation, controllerOperation);
  const showIdleOverrideReset = shouldShowIdleOverrideReset(controlsBusy, hasOverrides, ovCache);
  // Maintainer-directed rail order (ADR-225, amended 2026-07-17): origin
  // directly under the jog pad, job actions next so Start/Frame stay above the
  // fold on short windows, placement (a set-once compile setting that the Job
  // Review dialog re-shows at Start, ADR-224) below them, and the
  // hand-positioning guide last as a fallback.
  return (
    <div style={containerStyle}>
      <OriginRow disabled={disabled} streaming={controlsBusy} />
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <span style={sectionCaptionStyle}>{props.dockedJobActions ? 'Machine setup' : 'Job'}</span>
        <TutorialButton tutorialId="frame-start" label="Frame & Start tutorial" />
      </div>
      <SetupRow
        disabled={disabled}
        streaming={controlsBusy}
        onConfigureAutofocus={configure.autofocus}
        onConfigureHoming={configure.homing}
        onStartJob={onStartJob}
        dockedJobActions={props.dockedJobActions}
      />
      {!props.dockedJobActions && <StartBlockerNotice />}
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
      {needsRecovery && (
        <RunningControls
          isStreaming={isStreaming}
          isPaused={isPaused}
          isToolChange={isToolChange}
        />
      )}
      <PlacementSection streaming={controlsBusy} collapsed={props.dockedJobActions === true} />
      <IslandFillRecoveryAction streaming={controlsBusy} />
      <CheckpointResumeBanner busy={controlsBusy} />
      <RunAgainControl disabled={disabled} busy={controlsBusy} />
      <SecondPassControl busy={controlsBusy} machineKind={machineKind} />
      <ExecutionArchivePanel />
      <StartFromLineControl disabled={disabled} busy={controlsBusy} machineKind={machineKind} />
      <NoHomingPositionGuide disabled={disabled} streaming={controlsBusy} />
      {streamProgress.total > 0 && <ProgressBar progress={streamProgress} />}
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
  readonly onConfigureAutofocus: () => void;
  readonly onConfigureHoming: () => void;
  readonly onStartJob: () => void;
  readonly dockedJobActions: boolean | undefined;
}): JSX.Element {
  const setup = (
    <JobSetupControls
      disabled={props.disabled}
      streaming={props.streaming}
      onConfigureAutofocus={props.onConfigureAutofocus}
      onConfigureHoming={props.onConfigureHoming}
      compact={props.dockedJobActions === true}
    />
  );
  if (props.dockedJobActions) return <div style={actionGridStyle}>{setup}</div>;
  return (
    <JobActionControls
      disabled={props.disabled}
      streaming={props.streaming}
      onStartJob={props.onStartJob}
    >
      {setup}
    </JobActionControls>
  );
}

const doNothing = (): void => undefined;

function PlacementSection(props: {
  readonly streaming: boolean;
  readonly collapsed: boolean;
}): JSX.Element {
  const controls = <JobPlacementControls streaming={props.streaming} />;
  if (!props.collapsed) return controls;
  return (
    <CollapsibleRailSection
      label="Placement & output"
      title="Choose the start position, job origin, and artwork included in the job."
    >
      {controls}
    </CollapsibleRailSection>
  );
}

function ProgressBar({ progress }: { readonly progress: LiveStreamProgress }): JSX.Element {
  const display = describeProgressDisplay(progress);
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

function describeProgressDisplay(progress: LiveStreamProgress): {
  readonly percent: number;
  readonly label: string;
  readonly title: string;
} {
  const lineText = `${progress.completed} / ${progress.total}`;
  if (progress.status === 'done') {
    return {
      percent: 99,
      label: `Machine finishing (${lineText} sent)`,
      title:
        'GRBL has acknowledged every G-code line, but KerfDesk is waiting for Idle before marking the job complete.',
    };
  }
  return {
    percent: streamProgressPercent(progress),
    label: `${lineText} lines`,
    title: 'G-code lines acknowledged by the controller.',
  };
}
