// SafetyNoticeBanner — P0-B. A prominent, persistent alert shown when the laser
// store cannot guarantee the machine is in a safe state: a failed
// Stop/Pause/Resume/Disconnect write, or a USB drop while a job was running. The
// copy names the PHYSICAL E-stop because once the link is gone, no software
// command can stop motion (GRBL keeps executing its buffered commands). It
// stays until the operator explicitly acknowledges it. Reconnect does not
// clear it and neither action touches the separate interrupted-job checkpoint.

import { useLaserStore } from '../state/laser-store';
import type { LaserSafetyNotice } from '../state/laser-safety-notice';
import type { RecoveryRepositorySnapshot } from '../state/recovery';
import { useRecoveryRepositorySelection } from '../state/use-recovery-repository';
import { openMachineSetup } from './device-setup/machine-setup-dialog-store';
import { controllerActionFailureHandler } from './report-controller-action-failure';

// The checkpoint paragraph only where a job left one, or one is running: a
// refused Home or jog before any job has none to tell apart (UX audit U2-P2-2).
function selectCheckpointHeld(snapshot: RecoveryRepositorySnapshot): boolean {
  return snapshot.activeRun !== null || snapshot.recoveryCapsule !== null;
}

const SAFETY_NOTICE_TITLES: Record<LaserSafetyNotice['kind'], string> = {
  'write-failed': 'Controller write failed',
  'disconnect-during-job': 'Connection lost mid-job',
  'disconnect-during-fire': 'Connection lost during Fire',
  'disconnect-stop-unconfirmed': 'Controller stop not confirmed',
  'controller-error': 'Controller rejected a command',
  'stream-stalled': 'Controller stream stalled',
  'cnc-transition-unconfirmed': 'CNC Pause/Resume not confirmed',
  'controller-reboot': 'Controller rebooted mid-job',
  'frame-limit': 'Frame hit a machine limit',
  'home-unfinished': 'Home did not finish',
  'cnc-pause-lift-failed': 'Pause and lift stopped',
};

// A drop during a jog, Frame, Home, probe or auto-focus shares the job notice's
// kind, so stored and replayed notices still read "mid-job" (ADR-639).
function safetyNoticeTitle(notice: LaserSafetyNotice): string {
  if (notice.kind === 'disconnect-during-job' && notice.cause === 'motion') {
    return 'Connection lost while moving';
  }
  // A halt rejected nothing: the firmware stopped itself (UX audit U5-P3-6).
  if (notice.kind === 'controller-error' && notice.halted === true) {
    return 'Controller halted: press its reset button';
  }
  return SAFETY_NOTICE_TITLES[notice.kind];
}

type Props = {
  /** Reconnects the controller. Calling connect also tears down a stale link. */
  readonly onReconnect?: () => void;
  readonly reconnectDisabled?: boolean;
  /** Current transport recovery context, independent of this retained warning. */
  readonly reconnectRecommended?: boolean;
};

export function SafetyNoticeBanner(props: Props = {}): JSX.Element | null {
  const notice = useLaserStore((s) => s.safetyNotice);
  const connection = useLaserStore((s) => s.connection);
  const statusState = useLaserStore((s) => s.statusReport?.state ?? null);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const clear = useLaserStore((s) => s.clearSafetyNotice);
  const wakeController = useLaserStore((s) => s.wakeController);
  const checkpointHeld = useRecoveryRepositorySelection(selectCheckpointHeld);
  if (notice === null) return null;
  const title = safetyNoticeTitle(notice);
  const resetAvailable = connection.kind === 'connected' && statusState === 'Sleep';
  const reconnectRecommended =
    (props.reconnectRecommended ?? connection.kind !== 'connected') &&
    !(notice.kind === 'cnc-transition-unconfirmed' && connection.kind === 'connected');
  return (
    <div style={bannerStyle} role="alert">
      <strong style={titleStyle}>{title}</strong>
      <p style={messageStyle}>{notice.message}</p>
      {checkpointHeld ? (
        <p style={guidanceStyle}>
          This warning is separate from the interrupted-job checkpoint. Reconnecting or resetting
          the controller does not resume the job and does not erase that checkpoint.
        </p>
      ) : null}
      <div style={actionsStyle}>
        {reconnectRecommended && props.onReconnect !== undefined ? (
          <button
            type="button"
            onClick={props.onReconnect}
            disabled={props.reconnectDisabled || connection.kind === 'connecting'}
            style={recoverStyle}
            title="Close any stale serial session and reconnect the controller. This ends any paused job."
          >
            {connection.kind === 'connecting' ? 'Reconnecting…' : 'Reconnect controller…'}
          </button>
        ) : null}
        {notice.kind === 'controller-error' && notice.homingOff === true ? (
          <button
            type="button"
            onClick={() => openMachineSetup({ kind: 'step', step: 'confirm' })}
            style={recoverStyle}
            title="Open Machine Setup at Essentials, where Enable Home is set."
          >
            Open Machine Setup
          </button>
        ) : null}
        {resetAvailable ? (
          <button
            type="button"
            onClick={() => void wakeController().catch(controllerActionFailureHandler('Reset'))}
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
