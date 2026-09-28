// Trim Shapes (LBG-T04) and Cut Shapes (LBG-T08) in Tools → Vector. Trim
// Shapes is a canvas tool, checked while it is on, so choosing it again turns
// it off. Cut Shapes acts on the selection and explains in a notice when the
// selection cannot be cut.

import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

export function vectorCutCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    ctx.hasSelection
      ? enabled(
          'tools.cut-shapes',
          'tools',
          'Cut Shapes',
          'Split the selected shapes along the outline of the top-most closed one',
          ctx.cutShapes,
        )
      : disabled(
          'tools.cut-shapes',
          'tools',
          'Cut Shapes',
          'Select the shapes to cut and a closed shape on top of them first.',
          ctx.cutShapes,
        ),
    {
      ...enabled(
        'tools.trim-shapes',
        'tools',
        'Trim Shapes',
        ctx.trimShapesActive
          ? 'Stop trimming and return to the Select tool'
          : 'Click a stretch of outline to delete it back to the nearest crossings',
        ctx.trimShapes,
      ),
      active: ctx.trimShapesActive,
    },
  ];
}
