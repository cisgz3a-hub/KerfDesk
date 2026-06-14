// LaserWindow — Phase B controller panel. Connection, status, jog, job
// controls. Renders alongside the Cuts/Layers panel on the right rail.

import { describeAlarm } from '../../core/controllers/grbl';
import { usePlatform } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { ConnectionBar } from './ConnectionBar';
import { DetectedSettingsBanner } from './DetectedSettingsBanner';
import { DeviceSettings } from './DeviceSettings';
import { LaserLog } from './LaserLog';
import { StatusDisplay } from './StatusDisplay';
import { JogPad } from './JogPad';
import { JobControls } from './JobControls';
import { SafetyNoticeBanner } from './SafetyNoticeBanner';
import { runStartJobFlow } from './start-job-flow';

export function LaserWindow(): JSX.Element {
  const platform = usePlatform();
  const connection = useLaserStore((s) => s.connection);
  const alarmCode = useLaserStore((s) => s.alarmCode);
  const connect = useLaserStore((s) => s.connect);
  const disconnect = useLaserStore((s) => s.disconnect);
  const unlockAlarm = useLaserStore((s) => s.unlockAlarm);
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const streamer = useLaserStore((s) => s.streamer);
  const statusReport = useLaserStore((s) => s.statusReport);
  const machineOperationBusy = autofocusBusy || motionOperation !== null;
  // H6: jog mid-job interleaves $J= acks into the character-counted stream —
  // every ack pops the stream head, so the 120-byte RX accounting drifts and
  // GRBL's real buffer can overflow. Gate like Home/Frame/Start.
  const jobActive = isActiveJob(streamer);
  const controllerIdle = statusReport?.state === 'Idle';

  const supportsSerial = platform.serial.isSupported();

  return (
    <aside aria-label="Laser controls" className="lf-rail" style={panelStyle}>
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
      <DeviceSettings />
      <ConnectionBar
        connection={connection}
        onConnect={() => void connect(platform)}
        onDisconnect={() => void disconnect().catch(() => undefined)}
        disabled={!supportsSerial || machineOperationBusy}
      />
      {alarmCode !== null && <AlarmBanner code={alarmCode} onUnlock={() => void unlockAlarm()} />}
      <DetectedSettingsBanner />
      <StatusDisplay />
      <JogPad
        disabled={
          connection.kind !== 'connected' || !controllerIdle || machineOperationBusy || jobActive
        }
      />
      <JobControls
        disabled={connection.kind !== 'connected' || autofocusBusy}
        onStartJob={() => void runStartJobFlow()}
      />
      <LaserLog />
    </aside>
  );
}

function AlarmBanner({
  code,
  onUnlock,
}: {
  readonly code: number;
  readonly onUnlock: () => void;
}): JSX.Element {
  const alarm = describeAlarm(code);
  return (
    <div style={alarmStyle} role="alert">
      <strong>
        Alarm {code}: {alarm?.title ?? 'unknown'}
      </strong>
      <p style={alarmDetailStyle}>{alarm?.detail ?? ''}</p>
      <p style={alarmDetailStyle}>{alarm?.action ?? ''}</p>
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
const alarmDetailStyle: React.CSSProperties = { margin: '4px 0' };
