import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

export function stampPreparationCommand(ctx: AppCommandContext): AppCommand {
  const invoke = ctx.prepareStamp ?? (() => undefined);
  // Only a selection the tool accepts: one image or closed vectors, with
  // variable data left out (tools audit T32-P3-2, ADR-350 Amendment 3).
  return ctx.canPrepareStamp && ctx.prepareStamp !== undefined
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
        'Select one raster image or closed vector artwork first. Variable text and barcodes need Bake Variable Text.',
        invoke,
      );
}
