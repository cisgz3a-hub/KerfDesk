import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

export function stampPreparationCommand(ctx: AppCommandContext): AppCommand {
  const invoke = ctx.prepareStamp ?? (() => undefined);
  return ctx.hasSelection && ctx.prepareStamp !== undefined
    ? enabled(
        'tools.prepare-stamp',
        'tools',
        'Prepare Stamp…',
        'Review a stamp face, shoulder and recess height map in physical millimetres',
        invoke,
      )
    : disabled(
        'tools.prepare-stamp',
        'tools',
        'Prepare Stamp…',
        'Select one raster image or closed vector artwork first.',
        invoke,
      );
}
