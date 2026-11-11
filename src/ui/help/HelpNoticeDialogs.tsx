// Help > About and Help > Safety & liability as dialogs (ADR-707; annoyance
// audit A1-P3-1). They were native alerts: the safety notice's link could not
// be clicked, and during a job the whole 43-line notice was squeezed into a
// toast that left after eight seconds. A Dialog scrolls, stays until it is
// closed, and sits under the Live Motion bar, so both can be read while a job
// runs. ADR-613 Amendment 1 made the same move for the licence notice.

import { useCallback, useEffect, useState } from 'react';
import { APP_DISPLAY_NAME } from '../../core/app-branding';
import { Button, Dialog, DialogActions } from '../kit';
import { HELP_NOTICE_EVENT, type HelpNoticeKind } from './help-notices';
import { LICENSE_NOTICE_EVENT, LICENSE_NOTICE_TITLE } from './license-notice';
import { SAFETY_GUIDE_URL, SAFETY_NOTICE_BODY, SAFETY_NOTICE_TITLE } from './safety-notice';

/** Opens the notice a Help command asks for. */
export function HelpNoticeHost(): JSX.Element | null {
  const [open, setOpen] = useState<HelpNoticeKind | null>(null);
  useEffect(() => {
    const show = (event: Event): void => {
      const kind: unknown = event instanceof CustomEvent ? event.detail : null;
      if (kind === 'about' || kind === 'safety') setOpen(kind);
    };
    window.addEventListener(HELP_NOTICE_EVENT, show);
    return () => window.removeEventListener(HELP_NOTICE_EVENT, show);
  }, []);
  const close = useCallback(() => setOpen(null), []);
  if (open === 'about') return <AboutDialog onClose={close} />;
  if (open === 'safety') return <SafetyNoticeDialog onClose={close} />;
  return null;
}

export function SafetyNoticeDialog(props: { readonly onClose: () => void }): JSX.Element {
  return (
    <Dialog title={SAFETY_NOTICE_TITLE} size="lg" onClose={props.onClose}>
      {/* Focusable so the keyboard can scroll it. */}
      <pre tabIndex={0} aria-label={`${SAFETY_NOTICE_TITLE} text`} style={textStyle}>
        {SAFETY_NOTICE_BODY}
      </pre>
      <p style={footStyle}>
        Full guide:{' '}
        <a href={SAFETY_GUIDE_URL} target="_blank" rel="noopener noreferrer">
          {SAFETY_GUIDE_URL}
        </a>
      </p>
      <NoticeActions onClose={props.onClose} />
    </Dialog>
  );
}

export function AboutDialog(props: { readonly onClose: () => void }): JSX.Element {
  return (
    <Dialog title={`About ${APP_DISPLAY_NAME}`} size="sm" onClose={props.onClose}>
      <pre style={aboutStyle}>{aboutText()}</pre>
      <NoticeActions onClose={props.onClose} />
    </Dialog>
  );
}

// Close leads and takes the opening focus on About; the licence notice is one
// click away instead of a menu path to remember.
function NoticeActions(props: { readonly onClose: () => void }): JSX.Element {
  return (
    <DialogActions>
      <Button variant="primary" onClick={props.onClose}>
        Close
      </Button>
      <Button
        onClick={() => {
          props.onClose();
          window.dispatchEvent(new Event(LICENSE_NOTICE_EVENT));
        }}
      >
        {LICENSE_NOTICE_TITLE}…
      </Button>
    </DialogActions>
  );
}

export function aboutText(): string {
  return [
    `${APP_DISPLAY_NAME} ${__APP_VERSION__}`,
    `Commit ${__GIT_SHA__}`,
    `Built ${__BUILD_TIME__}`,
    '',
    'Copyright © 2026 Johann Stolk. All rights reserved.',
    // verify-packaged-preview-metadata.mjs finds the About asset by this line's
    // "Terms of use: License & Safety Notice" prefix.
    'Terms of use: License & Safety Notice, in the Help menu.',
    'Third-party components and their licences: see /third-party-notices.txt.',
    '',
    'SAFETY: this software drives laser and CNC machinery. Verify every',
    'job (preview, simulation, or air run) before cutting, and never',
    'leave a running machine unattended.',
  ].join('\n');
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
const aboutStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'inherit',
  fontSize: 13,
  whiteSpace: 'pre-wrap',
};
const footStyle: React.CSSProperties = { margin: 0, fontSize: 13 };
