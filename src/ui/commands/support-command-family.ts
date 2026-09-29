// support-command-family — Help-menu commands that open KerfDesk's support
// page on kerfdesk.com. The source repository is private, so customers can no
// longer reach GitHub Issues or Discussions. The page, not the app, names the
// current contact route, so it can change without a new release. The invokes
// open a URL (not a store action), so these builders need no AppCommandContext.
// The command ids keep their original names so saved shortcuts still resolve.

import { enabled, type AppCommand } from './command-types';

export const SUPPORT_URL = 'https://kerfdesk.com/support.html';
export const REPORT_PROBLEM_URL = `${SUPPORT_URL}#report`;

// Open a link in a new browser tab the same way DownloadDesktopLink's anchor
// does: a detached <a target="_blank" rel="noopener noreferrer"> click. rel
// keeps the opened page from reaching back through window.opener, and a plain
// anchor navigation needs no CSP connect-src exception and no popup-blocker
// allowance — unlike window.open, which appears nowhere else in the tree.
export function openExternalUrl(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.click();
}

export function reportBugCommand(): AppCommand {
  return enabled(
    'help.report-bug',
    'help',
    'Report a Problem',
    'Open KerfDesk support and see what to include in a problem report',
    () => openExternalUrl(REPORT_PROBLEM_URL),
  );
}

export function discussionsCommand(): AppCommand {
  return enabled(
    'help.discussions',
    'help',
    'Get Help',
    'Open KerfDesk support for questions, ideas and feedback',
    () => openExternalUrl(SUPPORT_URL),
  );
}

export function licenceCommand(): AppCommand {
  return enabled('help.licence', 'help', 'Licence', 'Manage your desktop licence and updates', () =>
    window.dispatchEvent(new Event('kerfdesk:licence-settings')),
  );
}
