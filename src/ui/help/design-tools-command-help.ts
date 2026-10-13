import type { DesignToolsCommandId } from '../commands/design-tools-command-types';
import type { CommandHelpTopic } from './command-help-topics';
import { LAYOUT_COMMAND_HELP } from './layout-command-help';
import { OPTIMIZE_SHAPES_COMMAND_HELP } from './optimize-shapes-command-help';
import { PARITY_TOOLS_COMMAND_HELP } from './parity-tools-command-help';
import { VECTOR_CUT_COMMAND_HELP } from './vector-cut-command-help';
import { WARP_DEFORM_COMMAND_HELP } from './warp-deform-command-help';

// LightBurn gap batch 5 (ADR-480) commands, and Copy Along Path (LBG-T09).
export const DESIGN_TOOLS_COMMAND_HELP: Readonly<Record<DesignToolsCommandId, CommandHelpTopic>> = {
  ...VECTOR_CUT_COMMAND_HELP,
  ...WARP_DEFORM_COMMAND_HELP,
  ...OPTIMIZE_SHAPES_COMMAND_HELP,
  ...LAYOUT_COMMAND_HELP,
  ...PARITY_TOOLS_COMMAND_HELP,
  'edit.select-contained': {
    family: 'edit',
    tooltip:
      'Keep the selection and add every unlocked, visible object lying fully inside a selected closed shape.',
  },
  'edit.select-smaller': {
    family: 'edit',
    tooltip:
      'Keep the selection and add every unlocked, visible object no wider and no taller than the selected artwork. Handy for picking up specks left by a trace.',
  },
  'edit.delete-duplicates': {
    family: 'edit',
    tooltip:
      'Delete artwork drawn twice in the same place on the same operation, including closed shapes that start elsewhere or run the other way. Locked artwork and image masks or text guides are kept.',
  },
  'tools.close-paths': {
    family: 'tools',
    tooltip:
      'Close the open paths of the selected artwork on any operation with a straight line back to the start, and report the widest gap closed.',
  },
  'tools.reverse-paths': {
    family: 'tools',
    tooltip:
      'Reverse the direction the selected paths are cut in. Closed paths keep their start point. Kerf offset sets its own direction.',
  },
  'tools.rubber-band-outline': {
    family: 'tools',
    tooltip:
      'Add one closed outline stretched around everything selected, as a rubber band would be, on a Line operation.',
  },
  'arrange.copy-along-path': {
    family: 'arrange',
    tooltip:
      'Copy the selected artwork along a guide path: a number of copies, a set spacing between centres or a set gap between edges, turned to follow the path. The top-most (last added) single path in the selection is the guide; the dialog can pick another. Reverse Direction on the guide flips which way turned copies face.',
  },
  'tools.bake-variable-text': {
    family: 'tools',
    tooltip:
      'Replace the fields of the selected variable text and variable barcodes with the value they would engrave now: the current CSV record, serial, date and cut settings. The result is ordinary text or a fixed code that no longer advances. Undo restores the fields.',
  },
  'tools.flatten-image-mask': {
    family: 'tools',
    tooltip:
      'Bake the mask into the image and crop it like Crop Image, then delete the mask shape unless it is locked or still used.',
  },
};
