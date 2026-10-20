// Job Review header strip: machine-kind badge, device profile name, the
// live connection/state readout (ADR-224), and — when this controller
// session verified GRBL laser mode — a small "Laser mode verified" chip in
// place of the former paragraph (v3). Reads the stores live so a disconnect
// while the review is open shows immediately.

import { assertNever, type MachineKind } from '../../../core/scene';
import { Icon } from '../../kit';
import { machineDisplayName } from '../../machine/machine-labels';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import {
  connectionLabelStyle,
  deviceNameStyle,
  headerRowStyle,
  machineBadgeStyle,
  verifiedChipStyle,
} from './job-review.styles';

export const LASER_MODE_VERIFIED_NOTE =
  'GRBL laser mode ($32=1) is verified for this controller session — no extra acknowledgement is needed.';

export function JobReviewHeader(props: {
  readonly machineKind: MachineKind;
  readonly laserModeVerified?: boolean;
}): JSX.Element {
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
      {props.laserModeVerified === true ? (
        <span role="note" title={LASER_MODE_VERIFIED_NOTE} style={verifiedChipStyle}>
          <Icon name="check" size={11} />
          Laser mode verified
        </span>
      ) : null}
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
