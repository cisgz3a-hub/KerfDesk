import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

export function rotarySetupCommand(ctx: AppCommandContext): AppCommand {
  if (!ctx.rotaryFeatureEnabled) {
    return disabled(
      'tools.rotary-setup',
      'tools',
      'Rotary Setup...',
      'Enable Rotary setup in Tools > Labs first.',
      ctx.rotarySetup,
    );
  }
  return ctx.rotaryProfileSupported
    ? enabled(
        'tools.rotary-setup',
        'tools',
        'Rotary Setup...',
        'Configure a roller or chuck rotary attachment',
        ctx.rotarySetup,
      )
    : disabled(
        'tools.rotary-setup',
        'tools',
        'Rotary Setup...',
        'The active machine profile does not support a rotary axis.',
        ctx.rotarySetup,
      );
}
