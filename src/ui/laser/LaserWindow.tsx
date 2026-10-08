// LaserWindow — status, jog and job controls on the machine rail. Connection
// and machine-profile settings live in the workspace's compact top bar.

import { useState } from 'react';
import type { GrblState } from '../../core/controllers/grbl';
import type { MachineKind } from '../../core/scene';
import { CollapsedRail, RailPanelHeading } from '../common';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import {
  jogFrameCommandBlockMessage,
  setupBlockingJobCommandBlockMessage,
} from '../state/laser-store-helpers';
import { useMachineRailVisibility } from '../state/use-machine-rail-visibility';
import { machineControlsLabel, machineDisplayName } from '../machine/machine-labels';
import { CncUtilitiesPanel } from '../machine/CncUtilitiesPanel';
import { CollapsibleRailSection } from './CollapsibleRailSection';
import { ConsolePanel } from './ConsolePanel';
import { SuperConsoleLauncher } from './super-console/SuperConsoleLauncher';
import { AlarmBanner } from './AlarmBanner';
import { openMachineSetup } from './device-setup';
import { StatusDisplay } from './StatusDisplay';
import { JogPad } from './JogPad';
import { MoveToPositionSection } from './MoveToPositionSection';
import { JobControls } from './JobControls';
import { MachineHoursSection } from './MachineHoursSection';
import { ProbePanel } from './ProbePanel';
import { runStartJobFlow } from './start-job-flow';
import { controllerActionFailureHandler } from './report-controller-action-failure';
import './LaserWindow.css';

export { forgetControllerAndClearStartBlockers } from './controller-connection-actions';

export function LaserWindow({
  dockedJobActions = false,
}: {
  readonly dockedJobActions?: boolean;
} = {}): JSX.Element {
  const machinePanel = useMachineRailVisibility();
  const connection = useLaserStore((s) => s.connection);
  const alarmCode = useLaserStore((s) => s.alarmCode);
  const controllerKind = useLaserStore((s) => s.activeControllerKind);
  const control = useControllerActions();
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  // By value: the report object is replaced on every 250 ms poll, and this
  // rail derives only Idle / Sleep / Alarm from it. Selecting the object
  // re-rendered the whole machine rail on each poll of a running job.
  const controllerState = useLaserStore((s) => s.statusReport?.state ?? null);
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  // ADR-101 §7: shared chrome re-labels machine-aware; behavior is identical.
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const machineOperationBusy = machineBusy(autofocusBusy, motionOperation, controllerOperation);
  // H6: mid-job jog acks corrupt RX accounting, so gate them like Home/Frame/Start.
  const jogBlocked = useJogBlocked();
  const controllerDisplay = controllerDisplayState(controllerState, alarmCode, control);
  const connected = connection.kind === 'connected';
  const jogPadDisabled = isJogPadDisabled(
    connected,
    controllerDisplay.idle,
    machineOperationBusy,
    jogBlocked,
  );
  // Homing lives on the Confirm settings step, which is not collapsed, so the
  // deep-link needs no section highlight.
  const openHomingSetup = (): void => openMachineSetup({ kind: 'step', step: 'confirm' });
  if (!machinePanel.isExpanded) {
    return <CollapsedMachineRail machineKind={machineKind} onExpand={machinePanel.toggle} />;
  }

  return (
    <aside
      aria-label={machineControlsLabel(machineKind)}
      className="lf-rail lf-machine-rail"
      style={panelStyle}
    >
      <MachineRailHeading machineKind={machineKind} onCollapse={machinePanel.toggle} />
      <section className="lf-machine-primary-controls" aria-label="Jog and machine status">
        {controllerDisplay.showAlarmBanner && (
          <AlarmBanner
            code={alarmCode}
            controllerKind={controllerKind}
            homingEnabled={homingEnabled}
            homeFromAlarm={control.homeFromAlarm}
            canUnlock={control.canUnlock}
            resetRequired={control.resetRequired}
            onHome={control.runHome}
            onConfigureHoming={openHomingSetup}
            onUnlock={control.runUnlock}
            onReset={control.runReset}
          />
        )}
        {controllerDisplay.sleep && <SleepBanner onWake={control.runWake} />}
        <JogPad disabled={jogPadDisabled} />
        <StatusDisplay />
      </section>
      <section className="lf-machine-details" aria-label="Machine tools">
        <MoveToPositionSection disabled={jogPadDisabled} />
        <ProbePanel />
        <JobControls
          setupExtras={<CncUtilitiesPanel />}
          dockedJobActions={dockedJobActions}
          disabled={connection.kind !== 'connected' || autofocusBusy}
          onConfigureAutofocus={() =>
            openMachineSetup({ kind: 'step', step: 'options', highlight: 'autofocus' })
          }
          onConfigureHoming={openHomingSetup}
          onStartJob={() => void runStartJobFlow()}
        />
        <MachineHoursSection />
        <MachineConsoleSection />
      </section>
    </aside>
  );
}

function useJogBlocked(): boolean {
  const jobBlocked = useLaserStore((s) => setupBlockingJobCommandBlockMessage(s) !== null);
  const controllerBlocked = useLaserStore((s) => jogFrameCommandBlockMessage(s) !== null);
  return jobBlocked || controllerBlocked;
}

function useControllerActions(): {
  readonly connect: ReturnType<typeof useLaserStore.getState>['connect'];
  readonly disconnect: ReturnType<typeof useLaserStore.getState>['disconnect'];
  readonly home: ReturnType<typeof useLaserStore.getState>['home'];
  readonly unlockAlarm: ReturnType<typeof useLaserStore.getState>['unlockAlarm'];
  readonly wakeController: ReturnType<typeof useLaserStore.getState>['wakeController'];
  readonly canUnlock: boolean;
  readonly homeFromAlarm: boolean;
  readonly resetRequired: boolean | 'homing-state';
  // Banner click handlers: a refusal becomes a toast instead of silence.
  readonly runHome: () => void;
  readonly runUnlock: () => void;
  readonly runWake: () => void;
  readonly runReset: () => void;
} {
  const home = useLaserStore((s) => s.home);
  const unlockAlarm = useLaserStore((s) => s.unlockAlarm);
  const wakeController = useLaserStore((s) => s.wakeController);
  return {
    connect: useLaserStore((s) => s.connect),
    disconnect: useLaserStore((s) => s.disconnect),
    home,
    unlockAlarm,
    wakeController,
    canUnlock: useLaserStore((s) => s.capabilities.unlock),
    homeFromAlarm: useLaserStore((s) => s.capabilities.homeFromAlarm !== false),
    resetRequired: useLaserStore((s) => s.resetRequired ?? false),
    runHome: () => void home().catch(controllerActionFailureHandler('Home')),
    runUnlock: () => void unlockAlarm().catch(controllerActionFailureHandler('Unlock')),
    runWake: () => void wakeController().catch(controllerActionFailureHandler('Wake')),
    runReset: () => void wakeController().catch(controllerActionFailureHandler('Reset')),
  };
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
  readonly onCollapse: () => void;
}): JSX.Element {
  return (
    <RailPanelHeading title={machineDisplayName(props.machineKind)} onCollapse={props.onCollapse} />
  );
}

// The docked console follows the transcript, which publishes several times a
// second during a job; behind a closed summary it re-rendered at that rate for
// nobody. While the section is closed it holds its last transcript instead,
// and it stays mounted so its filters and unsent draft survive a close.
function MachineConsoleSection(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <CollapsibleRailSection
      label="Console"
      title="Show advanced controller commands and communication history."
      onOpenChange={setOpen}
    >
      <ConsolePanel active={open} />
      <SuperConsoleLauncher />
    </CollapsibleRailSection>
  );
}

function hasAlarmRecovery(code: number | null, state: GrblState | null): boolean {
  return code !== null || state === 'Alarm';
}

function controllerDisplayState(
  state: GrblState | null,
  alarmCode: number | null,
  control: { readonly resetRequired: boolean | 'homing-state' },
): { readonly idle: boolean; readonly sleep: boolean; readonly showAlarmBanner: boolean } {
  const sleep = state === 'Sleep';
  // Stock GRBL stuck in its homing state reports Home, not Alarm, but needs the
  // Reset this banner offers (controller audit A-7, ADR-375).
  const homingState = control.resetRequired === 'homing-state';
  return {
    idle: state === 'Idle',
    sleep,
    showAlarmBanner: !sleep && (hasAlarmRecovery(alarmCode, state) || homingState),
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
        GRBL is ignoring normal jog, frame, and start commands. Wake sends Ctrl-X soft reset; the
        controller restarts locked in Alarm, so Unlock or Home it next. The reset clears Set origin
        here on stock GRBL and FluidNC, while grblHAL keeps it; set it again if the head moved.
      </p>
      <button type="button" onClick={onWake} title="Send Ctrl-X soft reset to wake GRBL.">
        Wake (Ctrl-X)
      </button>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  // The primary controls and lower machine tools own separate scrollers so
  // opening Console or History does not move the jog pad out of view. This
  // outer rail stays within the workspace body above its Frame/Start dock.
  // Surface chrome and spacing come from .lf-machine-rail; layout only here.
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  overflowY: 'hidden',
  overflowX: 'hidden',
  fontFamily: 'system-ui, sans-serif',
  display: 'flex',
  flexDirection: 'column',
};
const sleepStyle: React.CSSProperties = {
  border: '1px solid var(--lf-warning)',
  background: 'var(--lf-tint-warning)',
  color: 'var(--lf-warning-fg)',
  padding: 8,
  borderRadius: 4,
};
const alarmDetailStyle: React.CSSProperties = { margin: '4px 0' };
