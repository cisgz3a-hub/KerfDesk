// LaserWindow — Phase B controller panel. Connection, status, jog, job
// controls. Renders alongside the Cuts/Layers panel on the right rail.

import { useState } from 'react';
import { describeAlarm } from '../../core/controllers/grbl';
import type { MachineKind } from '../../core/scene';
import { CollapsedRail, RailPanelHeading } from '../common';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useLaserStore } from '../state/laser-store';
import {
  isActiveJob,
  jogFrameCommandBlockMessage,
  setupBlockingJobCommandBlockMessage,
} from '../state/laser-store-helpers';
import { machineControlsLabel, machineDisplayName } from '../machine/machine-labels';
import { CollapsibleRailSection } from './CollapsibleRailSection';
import { ConsolePanel } from './ConsolePanel';
import { ControllerConnectionControls } from './ControllerConnectionControls';
import { DetectedSettingsToast } from './DetectedSettingsToast';
import type { DeviceSetupOpenRequest } from './device-setup';
import { StatusDisplay } from './StatusDisplay';
import { JogPad } from './JogPad';
import { JobControls } from './JobControls';
import { ProbePanel } from './ProbePanel';
import { runStartJobFlow } from './start-job-flow';
import { STATUS_ALARM_START_MESSAGE } from './start-job-readiness';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useStartBlockerStore } from './start-blocker-store';
import { controllerQualificationStartBlockMessage } from '../state/laser-controller-qualification';

export function LaserWindow(): JSX.Element {
  const [machineSetupRequest, setMachineSetupRequest] = useState<DeviceSetupOpenRequest>();
  const machinePanel = useMachinePanelVisibility();
  const connection = useLaserStore((s) => s.connection);
  const alarmCode = useLaserStore((s) => s.alarmCode);
  const control = useControllerActions();
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const controllerQualification = useLaserStore((s) => s.controllerQualification);
  const controllerSessionEpoch = useLaserStore((s) => s.controllerSessionEpoch);
  const streamer = useLaserStore((s) => s.streamer);
  const statusReport = useLaserStore((s) => s.statusReport);
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  // ADR-101 §7: shared chrome re-labels machine-aware; behavior is identical.
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const machineOperationBusy = machineBusy(autofocusBusy, motionOperation, controllerOperation);
  // H6: mid-job jog acks corrupt RX accounting, so gate them like Home/Frame/Start.
  const jobActive = isActiveJob(streamer);
  const jogBlocked = useJogBlocked();
  const controllerDisplay = controllerDisplayState(statusReport, alarmCode);
  const connected = connection.kind === 'connected';
  if (!machinePanel.requestedVisible && !jobActive) {
    return <CollapsedMachineRail machineKind={machineKind} onExpand={machinePanel.toggle} />;
  }

  return (
    <aside aria-label={machineControlsLabel(machineKind)} className="lf-rail" style={panelStyle}>
      <DetectedSettingsToast />
      <MachineRailHeading
        machineKind={machineKind}
        jobActive={jobActive}
        onCollapse={machinePanel.toggle}
      />
      <ControllerConnectionControls
        machineKind={machineKind}
        autofocusBusy={autofocusBusy}
        motionOperation={motionOperation}
        controllerOperation={controllerOperation}
        openRequest={machineSetupRequest}
        onForget={confirmForgetController}
      />
      {controllerDisplay.showAlarmBanner && (
        <AlarmBanner
          code={alarmCode}
          homingEnabled={homingEnabled}
          canUnlock={control.canUnlock}
          onHome={() => void control.home().catch(() => undefined)}
          onUnlock={() => void control.unlockAlarm().catch(() => undefined)}
        />
      )}
      {controllerDisplay.sleep && (
        <SleepBanner onWake={() => void control.wakeController().catch(() => undefined)} />
      )}
      <StatusDisplay />
      <JogPad
        disabled={isJogPadDisabled(
          connected,
          controllerDisplay.idle,
          machineOperationBusy,
          jogBlocked,
        )}
      />
      <ProbePanel />
      <JobControls
        disabled={connection.kind !== 'connected' || autofocusBusy}
        startDisabledReason={qualificationStartDisabledReason(
          controllerQualification,
          controllerSessionEpoch,
        )}
        onConfigureAutofocus={() => setMachineSetupRequest({ initialStep: 'safety' })}
        onStartJob={() => void runStartJobFlow()}
      />
      <MachineConsoleSection />
    </aside>
  );
}

function confirmForgetController(): void {
  if (
    !jobAwareConfirm(
      'Forget this controller, remove its browser serial permission, and clear all controller and recovery state? Your canvas and machine profile will stay open.',
    )
  ) {
    return;
  }
  void (async () => {
    await useLaserStore.getState().forgetDevice?.();
    useStartBlockerStore.getState().clear();
  })().catch(() => undefined);
}

function useJogBlocked(): boolean {
  const jobBlocked = useLaserStore((s) => setupBlockingJobCommandBlockMessage(s) !== null);
  const controllerBlocked = useLaserStore((s) => jogFrameCommandBlockMessage(s) !== null);
  return jobBlocked || controllerBlocked;
}

function useMachinePanelVisibility(): {
  readonly requestedVisible: boolean;
  readonly toggle: () => void;
} {
  const requestedVisible = useUiStore((s) => s.railPanelVisibility.machine);
  const togglePanel = useUiStore((s) => s.toggleRailPanel);
  return { requestedVisible, toggle: () => togglePanel('machine') };
}

function useControllerActions(): {
  readonly connect: ReturnType<typeof useLaserStore.getState>['connect'];
  readonly disconnect: ReturnType<typeof useLaserStore.getState>['disconnect'];
  readonly home: ReturnType<typeof useLaserStore.getState>['home'];
  readonly unlockAlarm: ReturnType<typeof useLaserStore.getState>['unlockAlarm'];
  readonly wakeController: ReturnType<typeof useLaserStore.getState>['wakeController'];
  readonly canUnlock: boolean;
} {
  return {
    connect: useLaserStore((s) => s.connect),
    disconnect: useLaserStore((s) => s.disconnect),
    home: useLaserStore((s) => s.home),
    unlockAlarm: useLaserStore((s) => s.unlockAlarm),
    wakeController: useLaserStore((s) => s.wakeController),
    canUnlock: useLaserStore((s) => s.capabilities.unlock),
  };
}

function qualificationStartDisabledReason(
  qualification: ReturnType<typeof useLaserStore.getState>['controllerQualification'],
  currentEpoch: number,
): string | null {
  return controllerQualificationStartBlockMessage(qualification, currentEpoch);
}

function CollapsedMachineRail(props: {
  readonly machineKind: MachineKind;
  readonly onExpand: () => void;
}): JSX.Element {
  return (
    <CollapsedRail
      title={machineDisplayName(props.machineKind)}
      ariaLabel={`${machineControlsLabel(props.machineKind)} collapsed`}
      onExpand={props.onExpand}
    />
  );
}

function MachineRailHeading(props: {
  readonly machineKind: MachineKind;
  readonly jobActive: boolean;
  readonly onCollapse: () => void;
}): JSX.Element {
  return (
    <RailPanelHeading
      title={machineDisplayName(props.machineKind)}
      onCollapse={props.onCollapse}
      collapseDisabled={props.jobActive}
      collapseDisabledReason="Machine controls stay visible while a job is active so ABORT remains reachable."
    />
  );
}

function MachineConsoleSection(): JSX.Element {
  return (
    <CollapsibleRailSection
      label="Console"
      title="Show advanced controller commands and communication history."
    >
      <ConsolePanel />
    </CollapsibleRailSection>
  );
}

function hasAlarmRecovery(code: number | null, state: string | undefined): boolean {
  return code !== null || state === 'Alarm';
}

function controllerDisplayState(
  report: ReturnType<typeof useLaserStore.getState>['statusReport'],
  alarmCode: number | null,
): { readonly idle: boolean; readonly sleep: boolean; readonly showAlarmBanner: boolean } {
  const sleep = report?.state === 'Sleep';
  return {
    idle: report?.state === 'Idle',
    sleep,
    showAlarmBanner: !sleep && hasAlarmRecovery(alarmCode, report?.state),
  };
}

// A settled tool-change hold deliberately permits jog + Zero-Z so the operator
// can touch off the new bit — the same carve-out the store's setup gate makes
// (setupBlockingJobCommandBlockMessage). Without honouring it the multi-tool CNC
// flow dead-ends: Continue needs fresh work-Z evidence and the JogPad is the only
// UI that establishes it (G38). Passing that gate result here keeps the button
// state matched to what the store will actually allow; unsettled holds and any
// other active job keep the JogPad blocked.
function isJogPadDisabled(
  connected: boolean,
  controllerIdle: boolean,
  machineOperationBusy: boolean,
  jogBlocked: boolean,
): boolean {
  return !connected || !controllerIdle || machineOperationBusy || jogBlocked;
}

function machineBusy(
  autofocusBusy: boolean,
  motionOperation: unknown,
  controllerOperation: unknown,
): boolean {
  return autofocusBusy || motionOperation !== null || controllerOperation !== null;
}

function SleepBanner({ onWake }: { readonly onWake: () => void }): JSX.Element {
  return (
    <div style={sleepStyle} role="alert">
      <strong>Controller is asleep</strong>
      <p style={alarmDetailStyle}>
        GRBL is ignoring normal jog, frame, and start commands. Wake sends Ctrl-X soft reset, clears
        the temporary work origin, and waits for the controller to report Idle again.
      </p>
      <button type="button" onClick={onWake} title="Send Ctrl-X soft reset to wake GRBL.">
        Wake (Ctrl-X)
      </button>
    </div>
  );
}

function AlarmBanner({
  code,
  homingEnabled,
  canUnlock,
  onHome,
  onUnlock,
}: {
  readonly code: number | null;
  readonly homingEnabled: boolean;
  readonly canUnlock: boolean;
  readonly onHome: () => void;
  readonly onUnlock: () => void;
}): JSX.Element {
  const alarm = code === null ? null : describeAlarm(code);
  return (
    <div style={alarmStyle} role="alert">
      <strong>
        {code === null ? 'Controller reports Alarm' : `Alarm ${code}: ${alarm?.title ?? 'unknown'}`}
      </strong>
      <p style={alarmDetailStyle}>
        {code === null
          ? 'GRBL has locked jog, frame, and start until the machine is homed or unlocked.'
          : (alarm?.detail ?? '')}
      </p>
      <p style={alarmDetailStyle}>{alarm?.action ?? STATUS_ALARM_START_MESSAGE}</p>
      <AlarmRecoveryActions
        homingEnabled={homingEnabled}
        canUnlock={canUnlock}
        onHome={onHome}
        onUnlock={onUnlock}
      />
    </div>
  );
}

function AlarmRecoveryActions(props: {
  readonly homingEnabled: boolean;
  readonly canUnlock: boolean;
  readonly onHome: () => void;
  readonly onUnlock: () => void;
}): JSX.Element {
  return (
    <>
      <button
        type="button"
        onClick={props.onHome}
        disabled={!props.homingEnabled}
        title={
          props.homingEnabled
            ? 'Send $H. Use this only when the machine has working homing switches.'
            : 'Homing is disabled in Device settings. Enable "$H supported" first.'
        }
      >
        Home ($H)
      </button>
      {!props.homingEnabled && (
        <span style={alarmHintStyle}>
          Enable &quot;$H supported&quot; in Device settings if this machine has homing switches.
        </span>
      )}
      {props.canUnlock && (
        <button
          type="button"
          onClick={props.onUnlock}
          title="Send $X to unlock the controller after you have confirmed the machine is safe."
        >
          $X — Unlock
        </button>
      )}
    </>
  );
}

const panelStyle: React.CSSProperties = {
  // Explicit width + flexShrink: 0 so this rail cannot push the workspace
  // canvas off-screen when its sub-panels (DeviceSettings, ConsolePanel, etc.)
  // collectively grow. overflowY scrolls the column internally instead of
  // forcing the parent flexbox to stretch — without this, on a narrower
  // window the canvas (flex:1, minWidth:0) collapses to zero.
  // Surface chrome comes from .lf-rail; layout only here.
  padding: '8px 12px',
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  overflowY: 'auto',
  overflowX: 'hidden',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const alarmStyle: React.CSSProperties = {
  border: '1px solid var(--lf-danger)',
  background: 'var(--lf-tint-danger)',
  color: 'var(--lf-danger-fg)',
  padding: 8,
  borderRadius: 4,
};
const sleepStyle: React.CSSProperties = {
  border: '1px solid var(--lf-warning)',
  background: 'var(--lf-tint-warning)',
  color: 'var(--lf-warning-fg)',
  padding: 8,
  borderRadius: 4,
};
const alarmDetailStyle: React.CSSProperties = { margin: '4px 0' };
const alarmHintStyle: React.CSSProperties = { display: 'block', fontSize: 11, lineHeight: 1.3 };
