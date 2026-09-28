import type { VectorCutCommandId } from '../commands/vector-cut-command-types';
import type { CommandHelpTopic } from './command-help-topics';

// Trim Shapes (LBG-T04) and Cut Shapes (LBG-T08).
export const VECTOR_CUT_COMMAND_HELP: Readonly<Record<VectorCutCommandId, CommandHelpTopic>> = {
  'tools.trim-shapes': {
    family: 'tools',
    tooltip:
      'Turn on the Trim tool: hovering an outline highlights the stretch between its nearest crossings with other visible, unlocked outlines or itself, and a click deletes it. An outline that crosses nothing is deleted whole. Text and drawn shapes become plain paths when trimmed. Esc or another tool ends it.',
  },
  'tools.cut-shapes': {
    family: 'tools',
    tooltip:
      'Split every selected vector shape along the outline of the top-most selected closed shape into the part inside it and the part outside it, then remove that cutting shape. Pieces keep their operations and stay selected so you can move them apart.',
  },
};
