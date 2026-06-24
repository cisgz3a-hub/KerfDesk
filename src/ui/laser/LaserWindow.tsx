// LaserWindow — Phase B controller panel. Connection, status, jog, job
// controls. Renders alongside the Cuts/Layers panel on the right rail.

import { useState } from 'react';
import { describeAlarm } from '../../core/controllers/grbl';
import { usePlatform } from '../app/platform-context';
import { Button } from '../kit';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { ConnectionBar } from './ConnectionBar';
import { ConsolePanel } from './ConsolePanel';
import { DetectedSettingsToast } from './DetectedSettingsToast';
import { DeviceSetupWizard } from './device-setup';
import { MachineSetupDialog } from './MachineSetupDialog';
import { StatusDisplay } from './StatusDisplay';
import { JogPad } from './JogPad';
import { JobControls } from './JobControls';
import { SafetyNoticeBanner } from './SafetyNoticeBanner';
import { runStartJobFlow } from './start-job-flow';
import { STATUS_ALARM_START_MESSAGE } from './start-job-readiness';

export function LaserWindow(): JSX.Element {
  const [machineSetupOpen, setMachineSetupOpen] = useState(false);
  const [deviceSetupOpen, setDeviceSetupOpen] = useState(false);
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
  const machineOperationBusy = isMachineOperationBusy({
    autofocusBusy,
    motionOperation,
    controllerOperation,
  });
  // H6: jog mid-job interleaves $J= acks into the character-counted stream —
  // every ack pops the stream head, so the 120-byte RX accounting drifts and
  // GRBL's real buffer can overflow. Gate like Home/Frame/Start.
  const jobActive = isActiveJob(streamer);
  const controllerIdle = statusReport?.state === 'Idle';
  const controllerSleep = statusReport?.state === 'Sleep';
  const showAlarmBanner = !controllerSleep && hasAlarmRecovery(alarmCode, statusReport?.state);
  const connected = connection.kind === 'connected';

  const supportsSerial = platform.serial.isSupported();

  return (
    <aside aria-label="Laser controls" className="lf-rail" style={panelStyle}>
      <DetectedSettingsToast />
      <h2 className="lf-heading" style={headingStyle}>
        Laser
      </h2>
      <SafetyNoticeBanner />
      {!supportsSerial && (
        <p style={hintStyle}>
          Your browser doesn&apos;t support WebSerial. Use Chrome, Edge, Brave, or Arc, or install
          the Windows desktop app.
        </p>
      )}
      <Button variant="primary" onClick={() => setDeviceSetupOpen(true)}>
        Set up device
      </Button>
      <Button onClick={() => setMachineSetupOpen(true)}>Machine Setup</Button>
      {deviceSetupOpen && <DeviceSetupWizard onClose={() => setDeviceSetupOpen(false)} />}
      {machineSetupOpen && <MachineSetupDialog onClose={() => setMachineSetupOpen(false)} />}
      <ConnectionBar
        connection={connection}
        onConnect={() => void connect(platform)}
        onDisconnect={() => void disconnect().catch(() => undefined)}
        disabled={!supportsSerial || machineOperationBusy}
      />
      {showAlarmBanner && (
        <AlarmBanner
          code={alarmCode}
          homingEnabled={homingEnabled}
          onHome={() => void home().catch(() => undefined)}
          onUnlock={() => void unlockAlarm().catch(() => undefined)}
        />
      )}
      {controllerSleep && (
        <SleepBanner onWake={() => void wakeController().catch(() => undefined)} />
      )}
      <StatusDisplay />
      <JogPad
        disabled={isJogPadDisabled(connected, controllerIdle, machineOperationBusy, jobActive)}
      />
      <JobControls
        disabled={connection.kind !== 'connected' || autofocusBusy}
        onStartJob={() => void runStartJobFlow()}
      />
      <ConsolePanel />
    </aside>
  );
}

function hasAlarmRecovery(code: number | null, state: string | undefined): boolean {
  return code !== null || state === 'Alarm';
}

function isJogPadDisabled(
  connected: boolean,
  controllerIdle: boolean,
  machineOperationBusy: boolean,
  jobActive: boolean,
): boolean {
  return !connected || !controllerIdle || machineOperationBusy || jobActive;
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
  onHome,
  onUnlock,
}: {
  readonly code: number | null;
  readonly homingEnabled: boolean;
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
      <button
        type="button"
        onClick={onHome}
        disabled={!homingEnabled}
        title={
          homingEnabled
            ? 'Send $H. Use this only when the machine has working homing switches.'
            : 'Homing is disabled in Device settings. Enable "$H supported" first.'
        }
      >
        Home ($H)
      </button>
      {!homingEnabled && (
        <span style={alarmHintStyle}>
          Enable &quot;$H supported&quot; in Device settings if this machine has homing switches.
        </span>
      )}
      <button
        type="button"
        onClick={onUnlock}
        title="Send $X to unlock the controller after you have confirmed the machine is safe."
      >
        $X — Unlock
      </button>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  // Explicit width + flexShrink: 0 so this rail cannot push the workspace
  // canvas off-screen when its sub-panels (DeviceSettings, LaserLog, etc.)
  // collectively grow. overflowY scrolls the column internally instead of
  // forcing the parent flexbox to stretch — without this, on a narrower
  // window the canvas (flex:1, minWidth:0) collapses to zero.
  // Surface chrome comes from .lf-rail; layout only here.
  padding: '8px 12px',
  width: 300,
  flexShrink: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const headingStyle: React.CSSProperties = { margin: '0 0 4px 0' };
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
