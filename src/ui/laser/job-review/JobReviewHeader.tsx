// Job Review header strip: machine-kind badge, device profile name, and the
// live connection/state readout (ADR-224). Reads the stores live so a
// disconnect while the review is open shows immediately.

import { assertNever, type MachineKind } from '../../../core/scene';
import { machineDisplayName } from '../../machine/machine-labels';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import {
  connectionLabelStyle,
  deviceNameStyle,
  headerRowStyle,
  machineBadgeStyle,
} from './job-review.styles';

export function JobReviewHeader(props: { readonly machineKind: MachineKind }): JSX.Element {
  const deviceName = useStore((s) => s.project.device.name);
  const connectionKind = useLaserStore((s) => s.connection.kind);
  const machineState = useLaserStore((s) => s.statusReport?.state ?? null);
  const alarmCode = useLaserStore((s) => s.alarmCode);
  const status = connectionStatus(connectionKind, machineState, alarmCode);
  return (
    <div style={headerRowStyle}>
      <span style={machineBadgeStyle}>{machineDisplayName(props.machineKind).toUpperCase()}</span>
      <span style={deviceNameStyle}>{deviceName}</span>
      <span role="status" style={connectionLabelStyle}>
        <span aria-hidden="true" style={dotStyle(status.tone)} />
        {status.label}
      </span>
    </div>
  );
}

type StatusTone = 'success' | 'warning' | 'danger';

function connectionStatus(
  connectionKind: 'disconnected' | 'connecting' | 'connected' | 'failed',
  machineState: string | null,
  alarmCode: number | null,
): { readonly label: string; readonly tone: StatusTone } {
  switch (connectionKind) {
    case 'connected': {
      const state = machineState ?? 'no status yet';
      const alarm = alarmCode === null ? '' : ` (alarm ${alarmCode})`;
      return {
        label: `Connected — ${state}${alarm}`,
        tone: machineState === 'Idle' && alarmCode === null ? 'success' : 'warning',
      };
    }
    case 'connecting':
      return { label: 'Connecting…', tone: 'warning' };
    case 'failed':
      return { label: 'Connection failed', tone: 'danger' };
    case 'disconnected':
      return { label: 'Not connected', tone: 'danger' };
    default:
      return assertNever(connectionKind, 'connection kind');
  }
}

function dotStyle(tone: StatusTone): React.CSSProperties {
  const color =
    tone === 'success'
      ? 'var(--lf-success)'
      : tone === 'warning'
        ? 'var(--lf-warning)'
        : 'var(--lf-danger)';
  return { width: 8, height: 8, borderRadius: '50%', background: color, flex: '0 0 auto' };
}
