// SafetyNoticeBanner — P0-B. A prominent, persistent alert shown when the laser
// store cannot guarantee the machine is in a safe state: a failed
// Stop/Pause/Resume/Disconnect write, or a USB drop while a job was running. The
// copy names the PHYSICAL E-stop because once the link is gone, no software
// command can stop motion (GRBL keeps executing its buffered commands). It
// stays until the operator dismisses it (clearSafetyNotice) or a fresh connect
// clears it — it is deliberately not auto-hidden.

import { useLaserStore } from '../state/laser-store';

export function SafetyNoticeBanner(): JSX.Element | null {
  const notice = useLaserStore((s) => s.safetyNotice);
  const clear = useLaserStore((s) => s.clearSafetyNotice);
  const wakeController = useLaserStore((s) => s.wakeController);
  const disconnect = useLaserStore((s) => s.disconnect);
  if (notice === null) return null;
  const title =
    notice.kind === 'disconnect-during-job'
      ? 'Connection lost mid-job'
      : notice.kind === 'disconnect-during-fire'
        ? 'Connection lost during Fire'
        : notice.kind === 'controller-error'
          ? 'Controller rejected a command'
          : notice.kind === 'controller-reboot'
            ? 'Controller rebooted mid-job'
            : 'Command may not have sent';
  const ownershipLost = notice.kind === 'controller-ownership';
  return (
    <div style={bannerStyle} role="alert">
      <strong style={titleStyle}>{title}</strong>
      <p style={messageStyle}>{notice.message}</p>
      <div style={actionsStyle}>
        <button
          type="button"
          onClick={() =>
            void (ownershipLost ? disconnect() : wakeController()).catch(() => undefined)
          }
          style={recoverStyle}
          title={
            ownershipLost
              ? 'Disconnect this controller session. Reconnect after stopping every other sender.'
              : 'Send Ctrl-X soft reset and clear stuck local controller state.'
          }
        >
          {ownershipLost ? 'Disconnect controller' : 'Recover controller'}
        </button>
        <button
          type="button"
          onClick={clear}
          style={dismissStyle}
          title="Dismiss this safety notice after you have checked the machine."
        >
          Dismiss
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
