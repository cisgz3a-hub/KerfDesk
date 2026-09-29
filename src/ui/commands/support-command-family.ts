// support-command-family — Help-menu commands that open KerfDesk's support
// page on kerfdesk.com. The source repository is private, so customers can no
// longer reach GitHub Issues or Discussions. The page, not the app, names the
// current contact route, so it can change without a new release. The invokes
// open a URL (not a store action), so these builders need no AppCommandContext.
// The command ids keep their original names so saved shortcuts still resolve.

import { CHECK_UPDATES_EVENT } from '../licensing/update-status-text';
import { SUPPORT_REPORT_EVENT } from '../support/support-report-event';
import { enabled, type AppCommand } from './command-types';

export const SUPPORT_URL = 'https://kerfdesk.com/support.html';
export const REPORT_PROBLEM_URL = `${SUPPORT_URL}#report`;
// The pricing and policy pages that ship with the web app (ADR-524 Amendment 3).
// The Terms page links the privacy and refund policies from every page's footer.
export const PRICING_URL = 'https://kerfdesk.com/pricing/';
export const POLICIES_URL = 'https://kerfdesk.com/terms/';

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

// Saves a text file the customer reads and sends themselves (ADR-546).
export function supportReportCommand(): AppCommand {
  return enabled(
    'help.support-report',
    'help',
    'Save Support Report...',
    'Save a file with your version, machine and recent problems to send to KerfDesk support',
    () => window.dispatchEvent(new Event(SUPPORT_REPORT_EVENT)),
  );
}

// Desktop app only (ADR-554): the folder support asks for, and the one to back up.
export function openDataFolderCommand(invoke: () => void): AppCommand {
  return enabled(
    'help.open-data-folder',
    'help',
    'Open Data Folder',
    'Show the folder where KerfDesk keeps its settings, licence and support log',
    invoke,
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

export function pricingCommand(): AppCommand {
  return enabled(
    'help.pricing',
    'help',
    'Pricing',
    'Open the KerfDesk Free and Pro prices, and what each edition includes',
    () => openExternalUrl(PRICING_URL),
  );
}

export function policiesCommand(): AppCommand {
  return enabled(
    'help.policies',
    'help',
    'Terms and Policies',
    'Open the KerfDesk Terms of Service, Privacy Policy and Refund Policy',
    () => openExternalUrl(POLICIES_URL),
  );
}

// The desktop app's version and update status, with Check now and the beta
// choice; the web app explains that it updates itself (ADR-547).
export function checkForUpdatesCommand(): AppCommand {
  return enabled(
    'help.check-updates',
    'help',
    'Check for Updates...',
    'See which version you have, whether a newer one is ready, and get new versions early',
    () => window.dispatchEvent(new Event(CHECK_UPDATES_EVENT)),
  );
}

export function licenceCommand(): AppCommand {
  return enabled(
    'help.licence',
    'help',
    'Licence',
    'See your edition, unlock Pro and manage your licence key and devices',
    () => window.dispatchEvent(new Event('kerfdesk:licence-settings')),
  );
}
