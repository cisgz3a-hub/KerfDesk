import type { WarpDeformCommandId } from '../commands/warp-deform-command-types';
import type { CommandHelpTopic } from './command-help-topics';

// Warp and Deform (LightBurn gap LBG-T06).
export const WARP_DEFORM_COMMAND_HELP: Readonly<Record<WarpDeformCommandId, CommandHelpTopic>> = {
  'tools.warp': {
    family: 'tools',
    tooltip:
      'Drag four corner handles to warp the selected vector artwork in perspective, then press Enter to apply or Esc to cancel. Shift keeps the handles a parallelogram. Curves become fine lines, text and drawn shapes become paths, and images stay as they are.',
  },
  'tools.deform': {
    family: 'tools',
    tooltip:
      'Drag a 4 by 4 grid of handles to bend the selected vector artwork smoothly, then press Enter to apply or Esc to cancel. Curves become fine lines, text and drawn shapes become paths, and images stay as they are.',
  },
};
