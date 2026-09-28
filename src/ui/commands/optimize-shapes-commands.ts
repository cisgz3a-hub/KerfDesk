// Tools -> Vector -> Optimize Shapes... (LightBurn gap LBG-T22). Any selection
// may try it: one without unlocked vector artwork gets a notice saying why.

import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

export function optimizeShapesCommand(ctx: AppCommandContext): AppCommand {
  return ctx.hasSelection
    ? enabled(
        'tools.optimize-shapes',
        'tools',
        'Optimize Shapes...',
        'Smooth the selected outlines and fit them with lines, arcs and curves',
        ctx.optimizeShapes,
      )
    : disabled(
        'tools.optimize-shapes',
        'tools',
        'Optimize Shapes...',
        'Select the vector artwork to optimize first.',
        ctx.optimizeShapes,
      );
}
