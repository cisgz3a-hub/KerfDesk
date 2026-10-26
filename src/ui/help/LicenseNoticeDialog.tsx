// Help > License & Safety Notice (ADR-613 Amendment 1): the terms the Windows
// installer shows, readable in the app on Windows, macOS, Linux and in the
// browser. A scrolling dialog rather than window.alert: the notice is too long
// for a native alert box, and an alert stalls a running job (job-aware-dialogs).

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { LICENSE_NOTICE_EVENT, LICENSE_NOTICE_TEXT, LICENSE_NOTICE_TITLE } from './license-notice';

/** Opens the notice whenever Help > License & Safety Notice is chosen. */
export function LicenseNoticeHost(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = (): void => setOpen(true);
    window.addEventListener(LICENSE_NOTICE_EVENT, show);
    return () => window.removeEventListener(LICENSE_NOTICE_EVENT, show);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return open ? <LicenseNoticeDialog onClose={close} /> : null;
}

export function LicenseNoticeDialog(props: { readonly onClose: () => void }): JSX.Element {
  return (
    <Dialog title={LICENSE_NOTICE_TITLE} size="lg" onClose={props.onClose}>
      {/* Focusable so the keyboard can scroll it. */}
      <pre tabIndex={0} aria-label={`${LICENSE_NOTICE_TITLE} text`} style={textStyle}>
        {LICENSE_NOTICE_TEXT}
      </pre>
      <DialogActions>
        <Button onClick={props.onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

const textStyle: React.CSSProperties = {
  margin: 0,
  maxHeight: '60vh',
  overflow: 'auto',
  padding: 8,
  background: 'var(--lf-bg-input)',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  fontFamily: 'var(--lf-font-mono)',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
};
