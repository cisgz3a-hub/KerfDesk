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
  if (notice === null) return null;
  const title =
    notice.kind === 'disconnect-during-job'
      ? 'Connection lost mid-job'
      : notice.kind === 'controller-error'
        ? 'Controller rejected a command'
        : 'Command may not have sent';
  return (
    <div style={bannerStyle} role="alert">
      <strong style={titleStyle}>{title}</strong>
      <p style={messageStyle}>{notice.message}</p>
      <button type="button" onClick={clear} style={dismissStyle}>
        Dismiss
      </button>
    </div>
  );
}

const bannerStyle: React.CSSProperties = {
  border: '2px solid var(--lf-danger)',
  background: '#3a2326',
  color: 'var(--lf-danger-fg)',
  padding: 10,
  borderRadius: 4,
};
const titleStyle: React.CSSProperties = { fontSize: 13, display: 'block' };
const messageStyle: React.CSSProperties = { margin: '6px 0', fontSize: 12, lineHeight: 1.4 };
const dismissStyle: React.CSSProperties = {
  background: 'var(--lf-danger)',
  color: '#fff',
  border: 'none',
  borderRadius: 3,
  padding: '4px 10px',
  cursor: 'pointer',
};
