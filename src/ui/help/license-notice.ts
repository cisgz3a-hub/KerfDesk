// The KerfDesk License & Safety Notice, shown from Help on every platform
// (ADR-613 Amendment 1). It is public/eula.txt itself, bundled at build time:
// the file the Windows installer shows on its licence page, the site serves
// at /eula.txt and every desktop build ships. The Mac DMG and the Linux
// packages show no installer page, so this is where those operators read it.
// Edit the wording only in public/eula.txt, and only when the owner asks.

import NOTICE_TEXT from '../../../public/eula.txt?raw';

export const LICENSE_NOTICE_TEXT: string = NOTICE_TEXT;

/** The document's own name: a test keeps it equal to the notice's first line. */
export const LICENSE_NOTICE_TITLE = 'License & Safety Notice';

export const LICENSE_NOTICE_EVENT = 'kerfdesk:license-notice';
