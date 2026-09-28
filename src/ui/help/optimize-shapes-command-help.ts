import type { OptimizeShapesCommandId } from '../commands/optimize-shapes-command-types';
import type { CommandHelpTopic } from './command-help-topics';

// Optimize Shapes (LightBurn gap LBG-T22).
export const OPTIMIZE_SHAPES_COMMAND_HELP: Readonly<
  Record<OptimizeShapesCommandId, CommandHelpTopic>
> = {
  'tools.optimize-shapes': {
    family: 'tools',
    tooltip:
      'Smooth the selected vector outlines without shrinking them, keeping corners sharp and in place, then replace their points with lines, arcs and curves within a tolerance. The dialog says how many points become how many segments and how far anything moves. Text and drawn shapes that change become paths; locked artwork is left as it is. One undo step.',
  },
};
