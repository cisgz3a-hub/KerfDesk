import { useEffect } from 'react';
import { Button } from '../kit';
import { usePlatformOptional } from './platform-context';
import {
  installDesktopSessionEnd,
  SESSION_END_MESSAGES,
  useSessionEndStore,
} from './desktop-session-end';

/**
 * The desktop app's answer to Windows ending the session mid-job (ADR-548):
 * it keeps the main process told whether a job runs, and says what KerfDesk
 * did. Nonmodal, so Abort and the machine controls stay reachable.
 */
export function DesktopSessionEndNotice(): JSX.Element | null {
  const report = usePlatformOptional()?.reportJobActivity;
  const phase = useSessionEndStore((state) => state.phase);
  const dismiss = useSessionEndStore((state) => state.dismiss);
  useEffect(() => {
    if (report === undefined) return undefined;
    return installDesktopSessionEnd(window, report);
  }, [report]);
  if (phase === null) return null;
  return (
    <section role="alert" aria-label="Windows is ending the session" style={noticeStyle}>
      <span>{SESSION_END_MESSAGES[phase]}</span>
      <Button onClick={dismiss}>Dismiss</Button>
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
