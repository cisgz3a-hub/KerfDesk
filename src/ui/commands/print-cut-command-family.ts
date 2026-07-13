import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

export function printAndCutCommand(ctx: AppCommandContext): AppCommand {
  const available = ctx.printAndCutFeatureEnabled && ctx.printAndCutProfileSupported;
  return available
    ? enabled(
        'tools.print-and-cut',
        'tools',
        'Print and Cut...',
        'Register printed artwork from two machine points',
        ctx.printAndCut,
      )
    : disabled(
        'tools.print-and-cut',
        'tools',
        'Print and Cut...',
        ctx.printAndCutFeatureEnabled
          ? 'Print-and-Cut requires a homing-enabled absolute-position profile.'
          : 'Enable Print-and-Cut in Tools > Labs.',
        ctx.printAndCut,
      );
}
