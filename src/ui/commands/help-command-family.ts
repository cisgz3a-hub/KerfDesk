import { APP_DISPLAY_NAME } from '../../core/app-branding';
import { enabled, type AppCommand, type AppCommandContext } from './command-types';
import { useTutorialStore } from '../tutorials/tutorial-store';
import { openCommandSearch } from './command-search-store';
import { LICENSE_NOTICE_EVENT, LICENSE_NOTICE_TITLE } from '../help/license-notice';

export function findCommandCommand(): AppCommand {
  return enabled(
    'help.find-command',
    'help',
    'Find a command…',
    'Search every menu command by name or by what it does',
    openCommandSearch,
    'Ctrl+K',
  );
}

export function tutorialsCommand(): AppCommand {
  return enabled(
    'help.tutorials',
    'help',
    'Visual tutorials…',
    'Learn tools through illustrated steps',
    () => useTutorialStore.getState().openTutorial(),
  );
}

export function helpCommand(ctx: AppCommandContext): AppCommand {
  return enabled(
    'help.about',
    'help',
    `About ${APP_DISPLAY_NAME}`,
    'Show build information',
    ctx.showAbout,
  );
}

export function connectionHelpCommand(ctx: AppCommandContext): AppCommand {
  return enabled(
    'help.connection',
    'help',
    "Can't connect? (Troubleshooting)",
    'Show connection and USB driver troubleshooting steps',
    ctx.showConnectionHelp,
  );
}

export function safetyHelpCommand(ctx: AppCommandContext): AppCommand {
  return enabled(
    'help.safety',
    'help',
    'Safety & liability',
    'Show machine-safety and liability information — read before running a job',
    ctx.showSafety,
  );
}

// The bundled licence and safety terms: the text the Windows installer shows.
// The Mac and Linux packages show no installer page, so their operators read
// the terms here (ADR-613 Amendment 1).
export function licenseNoticeCommand(): AppCommand {
  return enabled(
    'help.license-notice',
    'help',
    LICENSE_NOTICE_TITLE,
    'Read the KerfDesk License & Safety Notice, the terms the installer shows',
    () => window.dispatchEvent(new Event(LICENSE_NOTICE_EVENT)),
  );
}
