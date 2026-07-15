// SafetyNoticeBanner — P0-B. A prominent, persistent alert shown when the laser
// store cannot guarantee the machine is in a safe state: a failed
// Stop/Pause/Resume/Disconnect write, or a USB drop while a job was running. The
// copy names the PHYSICAL E-stop because once the link is gone, no software
// command can stop motion (GRBL keeps executing its buffered commands). It
// stays until the operator explicitly acknowledges it. Reconnect does not
// clear it and neither action touches the separate interrupted-job checkpoint.

import { useLaserStore } from '../state/laser-store';
import type { LaserSafetyNotice } from '../state/laser-safety-notice';

const SAFETY_NOTICE_TITLES: Record<LaserSafetyNotice['kind'], string> = {
  'write-failed': 'Controller write failed',
  'disconnect-during-job': 'Connection lost mid-job',
  'disconnect-during-fire': 'Connection lost during Fire',
  'controller-error': 'Controller rejected a command',
  'stream-stalled': 'Controller stream stalled',
  'controller-reboot': 'Controller rebooted mid-job',
  'frame-limit': 'Frame hit a machine limit',
};

type Props = {
  /** Re-opens the serial picker. Calling connect also tears down a stale link. */
  readonly onReconnect?: () => void;
  readonly reconnectDisabled?: boolean;
};

export function SafetyNoticeBanner(props: Props = {}): JSX.Element | null {
  const notice = useLaserStore((s) => s.safetyNotice);
  const connection = useLaserStore((s) => s.connection);
  const statusState = useLaserStore((s) => s.statusReport?.state ?? null);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const clear = useLaserStore((s) => s.clearSafetyNotice);
  const wakeController = useLaserStore((s) => s.wakeController);
  if (notice === null) return null;
  const title = SAFETY_NOTICE_TITLES[notice.kind];
  const resetAvailable = connection.kind === 'connected' && statusState === 'Sleep';
  const reconnectRecommended =
    connection.kind !== 'connected' ||
    notice.kind === 'write-failed' ||
    notice.kind === 'stream-stalled';
  return (
    <div style={bannerStyle} role="alert">
      <strong style={titleStyle}>{title}</strong>
      <p style={messageStyle}>{notice.message}</p>
      <p style={guidanceStyle}>
        This warning is separate from the interrupted-job checkpoint. Reconnecting or resetting the
        controller does not resume the job and does not erase that checkpoint.
      </p>
      <div style={actionsStyle}>
        {reconnectRecommended && props.onReconnect !== undefined ? (
          <button
            type="button"
            onClick={props.onReconnect}
            disabled={props.reconnectDisabled || connection.kind === 'connecting'}
            style={recoverStyle}
            title="Tear down any stale serial session and open the controller connection picker."
          >
            {connection.kind === 'connecting' ? 'Reconnecting…' : 'Reconnect controller…'}
          </button>
        ) : null}
        {resetAvailable ? (
          <button
            type="button"
            onClick={() => void wakeController().catch(() => undefined)}
            disabled={controllerOperation !== null}
            style={recoverStyle}
            title="Send Ctrl-X to a connected sleeping controller. This does not resume the job."
          >
            Reset controller (does not resume job)
          </button>
        ) : null}
        <button
          type="button"
          onClick={clear}
          style={dismissStyle}
          title="Acknowledge this warning after using the physical E-stop or checking the machine."
        >
          I made the machine safe
        </button>
      </div>
    </div>
  );
}

const bannerStyle: React.CSSProperties = {
  border: '2px solid var(--lf-danger)',
  background: 'var(--lf-tint-danger)',
  color: 'var(--lf-danger-fg)',
  padding: 10,
  borderRadius: 4,
};
const titleStyle: React.CSSProperties = { fontSize: 13, display: 'block' };
const messageStyle: React.CSSProperties = { margin: '6px 0', fontSize: 12, lineHeight: 1.4 };
const guidanceStyle: React.CSSProperties = {
  margin: '6px 0',
  fontSize: 11,
  lineHeight: 1.4,
  fontWeight: 600,
};
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
const recoverStyle: React.CSSProperties = {
  background: 'var(--lf-bg)',
  color: 'var(--lf-danger-fg)',
  border: '1px solid var(--lf-danger)',
  borderRadius: 3,
  padding: '4px 10px',
  cursor: 'pointer',
};
const dismissStyle: React.CSSProperties = {
  background: 'var(--lf-danger)',
  color: 'var(--lf-on-fill)',
  border: 'none',
  borderRadius: 3,
  padding: '4px 10px',
  cursor: 'pointer',
};
