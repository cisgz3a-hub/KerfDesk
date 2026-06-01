// LaserWindow — Phase B controller panel. Connection, status, jog, job
// controls. Renders alongside the Cuts/Layers panel on the right rail.

import { describeAlarm } from '../../core/controllers/grbl';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { ConnectionBar } from './ConnectionBar';
import { DetectedSettingsBanner } from './DetectedSettingsBanner';
import { DeviceSettings } from './DeviceSettings';
import { LaserLog } from './LaserLog';
import { StatusDisplay } from './StatusDisplay';
import { JogPad } from './JogPad';
import { JobControls } from './JobControls';
import { prepareStartJob } from './start-job-readiness';

export function LaserWindow(): JSX.Element {
  const platform = usePlatform();
  const connection = useLaserStore((s) => s.connection);
  const alarmCode = useLaserStore((s) => s.alarmCode);
  const connect = useLaserStore((s) => s.connect);
  const disconnect = useLaserStore((s) => s.disconnect);
  const unlockAlarm = useLaserStore((s) => s.unlockAlarm);
  const startJob = useLaserStore((s) => s.startJob);

  const supportsSerial = platform.serial.isSupported();
  const onStartJob = async (): Promise<void> => {
    const project = useStore.getState().project;
    const laser = useLaserStore.getState();
    const prepared = prepareStartJob(project, laser.controllerSettings, {
      statusReport: laser.statusReport,
      alarmCode: laser.alarmCode,
      hasActiveStreamer:
        laser.streamer !== null &&
        (laser.streamer.status === 'streaming' || laser.streamer.status === 'paused'),
      workOriginActive: laser.workOriginActive,
      wcoCache: laser.wcoCache,
    });
    if (!prepared.ok) {
      const lines = prepared.messages.map((message) => `• ${message}`).join('\n');
      window.alert(`Cannot start job:\n\n${lines}`);
      return;
    }
    if (prepared.warnings.length > 0) {
      const lines = prepared.warnings.map((message) => `• ${message}`).join('\n');
      if (!window.confirm(`Controller warning:\n\n${lines}\n\nStart anyway?`)) return;
    }
    try {
      await startJob(prepared.gcode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.alert(`Could not start job:\n\n${message}`);
    }
  };

  return (
    <aside aria-label="Laser controls" style={panelStyle}>
      <h2 style={headingStyle}>Laser</h2>
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
        onDisconnect={() => void disconnect()}
        disabled={!supportsSerial}
      />
      {alarmCode !== null && <AlarmBanner code={alarmCode} onUnlock={() => void unlockAlarm()} />}
      <DetectedSettingsBanner />
      <StatusDisplay />
      <JogPad disabled={connection.kind !== 'connected'} />
      <JobControls
        disabled={connection.kind !== 'connected'}
        onStartJob={() => void onStartJob()}
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
      <button type="button" onClick={onUnlock}>
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
  background: '#f5f5f5',
  borderLeft: '1px solid #ddd',
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
const headingStyle: React.CSSProperties = { fontSize: 14, margin: '0 0 4px 0' };
const hintStyle: React.CSSProperties = { color: '#a04040', fontStyle: 'italic', margin: 0 };
const alarmStyle: React.CSSProperties = {
  border: '1px solid #c62828',
  background: '#ffebee',
  padding: 8,
  borderRadius: 4,
};
const alarmDetailStyle: React.CSSProperties = { margin: '4px 0', color: '#5d1a1a' };
