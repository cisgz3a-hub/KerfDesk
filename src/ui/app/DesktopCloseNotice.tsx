import { useSyncExternalStore } from 'react';
import { Button } from '../kit';
import { desktopCloseController } from './desktop-close-runtime';

/** Nonmodal: the machine controls and Abort stay reachable during a slow stop. */
export function DesktopCloseNotice(): JSX.Element | null {
  const notice = useSyncExternalStore(
    desktopCloseController.subscribe,
    desktopCloseController.getNotice,
  );
  if (notice === null) return null;
  return (
    <section role="status" aria-label="Close app" style={noticeStyle}>
      <span>{notice.message}</span>
      <div style={actionsStyle}>
        <Button onClick={desktopCloseController.keepOpen}>Keep app open</Button>
        {notice.retry === true ? (
          <Button onClick={desktopCloseController.retryStop}>
            {notice.kind === 'failed' ? 'Retry Abort' : 'Retry turning Fire off'}
          </Button>
        ) : null}
        {notice.kind === 'unconfirmed' ? (
          <Button onClick={() => desktopCloseController.acknowledgeWarning(notice)}>
            Acknowledge warning and close
          </Button>
        ) : null}
      </div>
    </section>
  );
}

const noticeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  padding: '8px 12px',
  borderBottom: '1px solid var(--lf-warning)',
  background: 'var(--lf-tint-warning)',
  color: 'var(--lf-warning-fg)',
  fontSize: 13,
};
const actionsStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
