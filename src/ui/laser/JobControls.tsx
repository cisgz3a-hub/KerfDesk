// JobControls — Machine-rail setup, detailed run status, overrides, and progress.
// Canonical live-job actions live in the App-shell LiveMotionBar (ADR-207).

import type { ReactNode } from 'react';
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
import { openMachineSetup } from './device-setup';
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
  readonly setupExtras?: ReactNode;
};

// Both setup entries are optional so bare <JobControls> renders standalone;
// resolving them here keeps the branches out of the component body.
function configureCallbacks(props: Props): {
  readonly autofocus: () => void;
  readonly homing: () => void;
} {
  return {
    autofocus:
      props.onConfigureAutofocus ??
      (() => openMachineSetup({ kind: 'step', step: 'options', highlight: 'autofocus' })),
    homing: props.onConfigureHoming ?? (() => openMachineSetup({ kind: 'step', step: 'confirm' })),
  };
}

export function JobControls(props: Props): JSX.Element {
  const { disabled, onStartJob } = props;
  const configure = configureCallbacks(props);
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  // Status by value: the streamer object is replaced on every acknowledgement
  // (ADR-333), and this section only branches on the status. The line count
  // lives in the LiveProgressBar leaf, so a burn re-renders that bar rather
  // than the whole Job section and every control inside it.
  const status = useLaserStore((s) => s.streamer?.status) ?? undefined;
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
      {!props.dockedJobActions && (
        <div className="lf-machine-section-heading">
          <span style={sectionCaptionStyle}>Job</span>
        </div>
      )}
      <SetupRow
        disabled={disabled}
        streaming={controlsBusy}
        onConfigureAutofocus={configure.autofocus}
        onConfigureHoming={configure.homing}
        onStartJob={onStartJob}
        dockedJobActions={props.dockedJobActions}
        setupExtras={props.setupExtras}
        setupLabel={machineKind === 'cnc' ? 'Homing & maintenance' : 'Homing & focus'}
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
      <CollapsibleRailSection
        label="History & recovery"
        title="View stored runs, export a previous execution, or restart an interrupted job."
      >
        <ExecutionArchivePanel />
        <StartFromLineControl disabled={disabled} busy={controlsBusy} machineKind={machineKind} />
      </CollapsibleRailSection>
      <NoHomingPositionGuide disabled={disabled} streaming={controlsBusy} />
      <LiveProgressBar />
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
  readonly setupExtras: ReactNode;
  readonly setupLabel: string;
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
  if (props.dockedJobActions) {
    return (
      <CollapsibleRailSection
        label={props.setupLabel}
        title="Home the machine, configure focus, and open machine maintenance tools."
      >
        <div style={actionGridStyle}>{setup}</div>
        {props.setupExtras}
      </CollapsibleRailSection>
    );
  }
  return (
    <>
      <JobActionControls
        disabled={props.disabled}
        streaming={props.streaming}
        onStartJob={props.onStartJob}
      >
        {setup}
      </JobActionControls>
      {props.setupExtras}
    </>
  );
}

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

// Throttled by useLiveStreamProgress; absent until the stream has a line total.
function LiveProgressBar(): JSX.Element | null {
  const progress = useLiveStreamProgress();
  return progress.total > 0 ? <ProgressBar progress={progress} /> : null;
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
