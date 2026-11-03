// Help > Can't connect? as an in-app dialog (UX audit U2-P3-6). It was a
// window.alert that could not link to the published guide, stalled a running
// job (job-aware-dialogs), and could not be reached while Machine Setup was
// open, because that window is modal. The Help menu and the toolbar hint open
// it through CONNECTION_HELP_EVENT; Machine Setup's connection strip renders it
// itself, over the setup window.

import { useCallback, useEffect, useState } from 'react';
import { openExternalUrl } from '../commands/support-command-family';
import { Button, Dialog, DialogActions } from '../kit';
import {
  CONNECTION_GUIDE_URL,
  CONNECTION_HELP_EVENT,
  CONNECTION_HELP_STEPS,
  CONNECTION_HELP_TITLE,
} from './connection-help';

/** Opens the help whenever Help > Can't connect? or a hint asks for it. */
export function ConnectionHelpHost(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = (): void => setOpen(true);
    window.addEventListener(CONNECTION_HELP_EVENT, show);
    return () => window.removeEventListener(CONNECTION_HELP_EVENT, show);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return open ? <ConnectionHelpDialog onClose={close} /> : null;
}

export function showConnectionHelp(): void {
  window.dispatchEvent(new Event(CONNECTION_HELP_EVENT));
}

export function ConnectionHelpDialog(props: { readonly onClose: () => void }): JSX.Element {
  return (
    <Dialog title={CONNECTION_HELP_TITLE} size="lg" onClose={props.onClose}>
      {/* Focusable so the keyboard can scroll it. */}
      <pre tabIndex={0} aria-label="Connection troubleshooting steps" style={textStyle}>
        {CONNECTION_HELP_STEPS}
      </pre>
      <DialogActions>
        <Button
          onClick={() => openExternalUrl(CONNECTION_GUIDE_URL)}
          title={`Open ${CONNECTION_GUIDE_URL} in your browser`}
        >
          Full guide on kerfdesk.com
        </Button>
        <Button variant="primary" onClick={props.onClose}>
          Close
        </Button>
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
