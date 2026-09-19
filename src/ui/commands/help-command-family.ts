import { APP_DISPLAY_NAME } from '../../core/app-branding';
import { enabled, type AppCommand, type AppCommandContext } from './command-types';
import { useTutorialStore } from '../tutorials/tutorial-store';

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
