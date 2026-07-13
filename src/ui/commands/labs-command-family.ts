import { enabled, type AppCommand, type AppCommandContext } from './command-types';

export function labsCommand(ctx: AppCommandContext): AppCommand {
  return enabled(
    'tools.labs',
    'tools',
    'Labs...',
    'Enable experimental machine workflows',
    ctx.labsSettings,
  );
}
