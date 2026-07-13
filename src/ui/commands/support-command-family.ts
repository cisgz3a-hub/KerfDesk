// support-command-family — Help-menu commands that open KerfDesk's public
// GitHub support surfaces. Bugs go to the Issues form; feature ideas,
// questions, and general feedback go to Discussions. The invokes open a URL
// (not a store action), so these builders need no AppCommandContext.

import { enabled, type AppCommand } from './command-types';

const GITHUB_REPO_URL = 'https://github.com/cisgz3a-hub/KerfDesk';
// /issues/new/choose lands on the template picker (the bug form plus the
// Discussions contact link from .github/ISSUE_TEMPLATE/config.yml), so one
// menu entry covers "report a bug" and still points elsewhere for the rest.
export const REPORT_BUG_URL = `${GITHUB_REPO_URL}/issues/new/choose`;
export const DISCUSSIONS_URL = `${GITHUB_REPO_URL}/discussions`;

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
    'Report a Bug',
    'Open a pre-filled bug report on GitHub',
    () => openExternalUrl(REPORT_BUG_URL),
  );
}

export function discussionsCommand(): AppCommand {
  return enabled(
    'help.discussions',
    'help',
    'Discussions & Feedback',
    'Open KerfDesk Discussions on GitHub',
    () => openExternalUrl(DISCUSSIONS_URL),
  );
}
