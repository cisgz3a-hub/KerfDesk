// JobControls — Machine-rail setup, detailed run status, overrides, and progress.
// Canonical live-job actions live in the App-shell LiveMotionBar (ADR-207).

import type { ReactNode } from 'react';
import type { GrblState } from '../../core/controllers/grbl';
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
import { JobStartMarkControl } from './JobStartMarkControl';
import { jobControlsBusy, jobNeedsRecovery } from './job-controls-busy';
import { CollapsibleRailSection } from './CollapsibleRailSection';
import { MachineToolsDropdowns } from './MachineToolsDropdowns';
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
  /** LaserWindow places the ordinary setup and Set-origin actions beside jog. */
  readonly machineActionsInJogPad?: boolean;
  readonly originExtras?: ReactNode;
  readonly machineConsole?: (active: boolean) => ReactNode;
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
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const hasOverrides = useLaserStore((s) => s.capabilities.overrides);
  const ovCache = useLaserStore((s) => s.ovCache);
  const accessoryCache = useLaserStore((s) => s.accessoryCache ?? null);
  const controllerState = useLaserStore((s) => s.statusReport?.state ?? null);
  const controlsBusy = jobControlsBusy(status, motionOperation, controllerOperation);
  const showIdleOverrideReset = shouldShowIdleOverrideReset(controlsBusy, hasOverrides, ovCache);
  // Standalone consumers keep all setup actions. The integrated rail keeps
  // origin utilities here while its ordinary actions live beside the jog pad.
  return (
    <div style={containerStyle}>
      <JobToolControls {...props} streaming={controlsBusy} machineKind={machineKind} />
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
        setupExtras={props.machineConsole ? undefined : props.setupExtras}
        setupLabel={machineKind === 'cnc' ? 'Homing & maintenance' : 'Homing & focus'}
        machineActionsInJogPad={props.machineActionsInJogPad}
      />
      {!props.dockedJobActions && <StartBlockerNotice />}
      {!props.machineConsole && <JobStartMarkControl disabled={disabled} />}
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
      <RunningJobStatus status={status} controllerState={controllerState} />
      {!props.machineConsole && (
        <PlacementSection streaming={controlsBusy} collapsed={props.dockedJobActions === true} />
      )}
      <IslandFillRecoveryAction streaming={controlsBusy} />
      <CheckpointResumeBanner busy={controlsBusy} />
      <RunAgainControl disabled={disabled} busy={controlsBusy} />
      <SecondPassControl busy={controlsBusy} machineKind={machineKind} />
      {!props.machineConsole && (
        <>
          <HistoryRecoveryControls
            disabled={disabled}
            busy={controlsBusy}
            machineKind={machineKind}
          />
          <NoHomingPositionGuide disabled={disabled} streaming={controlsBusy} />
        </>
      )}
      <LiveProgressBar />
    </div>
  );
}

function JobToolControls(
  props: Pick<
    Props,
    'disabled' | 'machineActionsInJogPad' | 'originExtras' | 'setupExtras' | 'machineConsole'
  > & { readonly streaming: boolean; readonly machineKind: 'laser' | 'cnc' },
): JSX.Element {
  if (!props.machineConsole) return <JobOriginControls {...props} />;
  return (
    <MachineToolsDropdowns
      origin={
        <>
          <JobOriginControls {...props} />
          <JobStartMarkControl disabled={props.disabled} />
          {props.originExtras}
          <NoHomingPositionGuide disabled={props.disabled} streaming={props.streaming} />
        </>
      }
      placement={
        <>
          <JobPlacementControls streaming={props.streaming} />
          {props.setupExtras}
        </>
      }
      console={(active) => (
        <>
          {props.machineConsole?.(active)}
          <HistoryRecoveryControls
            disabled={props.disabled}
            busy={props.streaming}
            machineKind={props.machineKind}
          />
        </>
      )}
    />
  );
}

function RunningJobStatus(props: {
  readonly status: string | undefined;
  readonly controllerState: GrblState | null;
}): JSX.Element | null {
  // 'done' and 'errored' both keep the rail's recovery status mounted. The
  // App-shell LiveMotionBar independently owns Abort. A finished job stays active
  // (isActiveJob) until a later Idle status clears the streamer, keeping jog
  // blocked while the machine finishes motion. Errors need an explicit Abort;
  // the Live Motion bar remains mounted through that window and tool-change holds.
  if (!jobNeedsRecovery(props.status)) return null;
  return (
    <RunningControls
      isStreaming={props.status === 'streaming'}
      isPaused={props.status === 'paused'}
      isToolChange={props.status === 'tool-change'}
      isFinishingTail={
        props.status === 'done' &&
        (props.controllerState === 'Run' ||
          props.controllerState === 'Hold' ||
          props.controllerState === 'Door')
      }
    />
  );
}

function HistoryRecoveryControls(props: {
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly machineKind: 'laser' | 'cnc';
}): JSX.Element {
  return (
    <CollapsibleRailSection
      label="History & recovery"
      title="View stored runs, export a previous execution, or restart an interrupted job."
    >
      <ExecutionArchivePanel />
      <StartFromLineControl {...props} />
    </CollapsibleRailSection>
  );
}

function JobOriginControls(
  props: Pick<Props, 'disabled' | 'machineActionsInJogPad'> & { readonly streaming: boolean },
): JSX.Element | null {
  return (
    <OriginRow
      disabled={props.disabled}
      streaming={props.streaming}
      layout={props.machineActionsInJogPad ? 'utilities' : 'all'}
    />
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
  readonly machineActionsInJogPad: boolean | undefined;
}): JSX.Element | null {
  const setup = props.machineActionsInJogPad ? null : (
    <JobSetupControls
      disabled={props.disabled}
      streaming={props.streaming}
      onConfigureAutofocus={props.onConfigureAutofocus}
      onConfigureHoming={props.onConfigureHoming}
      compact={props.dockedJobActions === true}
    />
  );
  if (props.dockedJobActions) {
    if (setup === null && props.setupExtras == null) return null;
    return (
      <CollapsibleRailSection
        label={setup === null ? 'Machine maintenance' : props.setupLabel}
        title={
          setup === null
            ? 'Open machine maintenance tools.'
            : 'Home the machine, configure focus, and open machine maintenance tools.'
        }
      >
        {setup !== null && <div style={actionGridStyle}>{setup}</div>}
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
