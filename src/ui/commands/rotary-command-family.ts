import { enabled, type AppCommand, type AppCommandContext } from './command-types';

export function rotarySetupCommand(ctx: AppCommandContext): AppCommand {
  return enabled(
    'tools.rotary-setup',
    'tools',
    'Rotary Setup...',
    'Configure a roller or chuck rotary attachment',
    ctx.rotarySetup,
  );
}
