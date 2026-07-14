// LaserWindow — Phase B controller panel. Connection, status, jog, job
// controls. Renders alongside the Cuts/Layers panel on the right rail.

import { describeAlarm } from '../../core/controllers/grbl';
import { selectControllerDriver } from '../../core/controllers';
import type { MachineKind } from '../../core/scene';
import { usePlatform } from '../app/platform-context';
import { CollapsedRail, RailPanelHeading } from '../common';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useLaserStore } from '../state/laser-store';
import {
  isActiveJob,
  jogFrameCommandBlockMessage,
  setupBlockingJobCommandBlockMessage,
} from '../state/laser-store-helpers';
import { machineControlsLabel, machineDisplayName, machineNoun } from '../machine/machine-labels';
import { ConnectionBar } from './ConnectionBar';
import { CollapsibleRailSection } from './CollapsibleRailSection';
import { ConsolePanel } from './ConsolePanel';
import { DetectedSettingsToast } from './DetectedSettingsToast';
import { DeviceSetupControls } from './device-setup';
import { StatusDisplay } from './StatusDisplay';
import { JogPad } from './JogPad';
import { JobControls } from './JobControls';
import { ProbePanel } from './ProbePanel';
import { SafetyNoticeBanner } from './SafetyNoticeBanner';
import { runStartJobFlow } from './start-job-flow';
import { STATUS_ALARM_START_MESSAGE } from './start-job-readiness';
import { jobAwareConfirm } from '../state/job-aware-dialogs';

export function LaserWindow(): JSX.Element {
  const machinePanel = useMachinePanelVisibility();
  const platform = usePlatform();
  const connection = useLaserStore((s) => s.connection);
  const alarmCode = useLaserStore((s) => s.alarmCode);
  const connect = useLaserStore((s) => s.connect);
  const disconnect = useLaserStore((s) => s.disconnect);
  const home = useLaserStore((s) => s.home);
  const unlockAlarm = useLaserStore((s) => s.unlockAlarm);
  const wakeController = useLaserStore((s) => s.wakeController);
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const streamer = useLaserStore((s) => s.streamer);
  const statusReport = useLaserStore((s) => s.statusReport);
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  // ADR-101 §7: shared chrome re-labels machine-aware; behavior is identical.
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const controllerKind = useStore((s) => s.project.device.controllerKind);
  const profileBaudRate = useStore((s) => s.project.device.baudRate);
  const canUnlock = useLaserStore((s) => s.capabilities.unlock);
  const machineOperationBusy = isMachineOperationBusy({
    autofocusBusy,
    motionOperation,
    controllerOperation,
  });
  // H6: jog mid-job interleaves $J= acks into the character-counted stream —
  // every ack pops the stream head, so the 120-byte RX accounting drifts and
  // GRBL's real buffer can overflow. Gate like Home/Frame/Start.
  const jobActive = isActiveJob(streamer);
  const jogBlocked = useJogBlocked();
  const controllerIdle = statusReport?.state === 'Idle';
  const controllerSleep = statusReport?.state === 'Sleep';
  const showAlarmBanner = !controllerSleep && hasAlarmRecovery(alarmCode, statusReport?.state);
  const connected = connection.kind === 'connected';

  const supportsSerial = platform.serial.isSupported();
  // File-only profiles (Ruida .rd export) have no live link to open — the
  // Connect button and machine controls stay dark and a hint explains why.
  const isFileOnlyProfile = isFileOnlyController(controllerKind);

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
      <SafetyNoticeBanner />
      <ConnectionHints supportsSerial={supportsSerial} isFileOnlyProfile={isFileOnlyProfile} />
      <DeviceSetupControls />
      <ConnectionBar
        connection={connection}
        machineNoun={machineNoun(machineKind)}
        onConnect={() => void connect(platform, { controllerKind, baudRate: profileBaudRate })}
        onDisconnect={() => void disconnect().catch(() => undefined)}
        onForget={confirmForgetDevice}
        disabled={!supportsSerial || machineOperationBusy || isFileOnlyProfile}
      />
      {showAlarmBanner && (
        <AlarmBanner
          code={alarmCode}
          homingEnabled={homingEnabled}
          canUnlock={canUnlock}
          onHome={() => void home().catch(() => undefined)}
          onUnlock={() => void unlockAlarm().catch(() => undefined)}
        />
      )}
      {controllerSleep && (
        <SleepBanner onWake={() => void wakeController().catch(() => undefined)} />
      )}
      <StatusDisplay />
      <JogPad
        disabled={isJogPadDisabled(connected, controllerIdle, machineOperationBusy, jogBlocked)}
      />
      <ProbePanel />
      <JobControls
        disabled={connection.kind !== 'connected' || autofocusBusy}
        onStartJob={() => void runStartJobFlow()}
      />
      <MachineConsoleSection />
    </aside>
  );
}

function confirmForgetDevice(): void {
  if (!jobAwareConfirm('Forget this device and remove its browser serial permission?')) return;
  void useLaserStore
    .getState()
    .forgetDevice?.()
    .catch(() => undefined);
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

function isFileOnlyController(
  controllerKind: Parameters<typeof selectControllerDriver>[0],
): boolean {
  return selectControllerDriver(controllerKind).capabilities.transport === 'file-only';
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

function ConnectionHints(props: {
  readonly supportsSerial: boolean;
  readonly isFileOnlyProfile: boolean;
}): JSX.Element | null {
  if (props.isFileOnlyProfile) {
    return (
      <p style={hintStyle}>
        This profile is file-export only: use Save G-code… to write an experimental .rd job and run
        it from the machine panel. Live Ruida streaming is not available in this build.
      </p>
    );
  }
  if (!props.supportsSerial) {
    return (
      <p style={hintStyle}>
        Your browser doesn&apos;t support WebSerial. Use Chrome, Edge, Brave (may require enabling
        under Brave Shields/flags), or Arc, or install the Windows desktop app.
      </p>
    );
  }
  return null;
}

function hasAlarmRecovery(code: number | null, state: string | undefined): boolean {
  return code !== null || state === 'Alarm';
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

function isMachineOperationBusy(state: {
  readonly autofocusBusy: boolean;
  readonly motionOperation: unknown;
  readonly controllerOperation: unknown;
}): boolean {
  return (
    state.autofocusBusy || state.motionOperation !== null || state.controllerOperation !== null
  );
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
const hintStyle: React.CSSProperties = {
  color: 'var(--lf-danger-fg)',
  fontStyle: 'italic',
  margin: 0,
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
