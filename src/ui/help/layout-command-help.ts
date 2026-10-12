import type { LayoutCommandId } from '../commands/layout-command-types';
import type { CommandHelpTopic } from './command-help-topics';

const DRAW_ORDER_NOTE =
  'Only what is drawn on top changes; the order the laser cuts in stays as set in the run order.';

const DOCK_TIP =
  'until its bounding box meets another object or the bed edge, keeping the docking padding. Artwork inside a frame docks past the frame. Docking Options sets the padding and grouping.';

const DOCK_HELP = {
  'arrange.dock-left': { family: 'arrange', tooltip: `Slide the selection left ${DOCK_TIP}` },
  'arrange.dock-right': { family: 'arrange', tooltip: `Slide the selection right ${DOCK_TIP}` },
  'arrange.dock-up': { family: 'arrange', tooltip: `Slide the selection up ${DOCK_TIP}` },
  'arrange.dock-down': { family: 'arrange', tooltip: `Slide the selection down ${DOCK_TIP}` },
} as const satisfies Partial<Record<LayoutCommandId, CommandHelpTopic>>;

export const LAYOUT_COMMAND_HELP: Readonly<Record<LayoutCommandId, CommandHelpTopic>> = {
  'arrange.bring-to-front': {
    family: 'arrange',
    tooltip: `Draw the selected artwork on top of everything else, so it can be seen and clicked over an image. ${DRAW_ORDER_NOTE}`,
  },
  'arrange.bring-forward': {
    family: 'arrange',
    tooltip: `Draw the selected artwork one step higher in the stack. ${DRAW_ORDER_NOTE}`,
  },
  'arrange.send-backward': {
    family: 'arrange',
    tooltip: `Draw the selected artwork one step lower in the stack. ${DRAW_ORDER_NOTE}`,
  },
  'arrange.send-to-back': {
    family: 'arrange',
    tooltip: `Draw the selected artwork behind everything else. ${DRAW_ORDER_NOTE}`,
  },
  'arrange.same-width': {
    family: 'arrange',
    tooltip:
      'Resize every selected object or group about its centre to the width of the reference: the last object clicked into the selection. Heights stay as they are.',
  },
  'arrange.same-height': {
    family: 'arrange',
    tooltip:
      'Resize every selected object or group about its centre to the height of the reference: the last object clicked into the selection. Widths stay as they are.',
  },
  'arrange.same-width-proportional': {
    family: 'arrange',
    tooltip:
      'Match the reference width and scale each height to keep its proportions, like Shift+click in LightBurn.',
  },
  'arrange.same-height-proportional': {
    family: 'arrange',
    tooltip:
      'Match the reference height and scale each width to keep its proportions, like Shift+click in LightBurn.',
  },
  'arrange.move-together-horizontal': {
    family: 'arrange',
    tooltip:
      'Slide the selected objects or groups left or right until their edges touch, in their current order. The reference (the last one clicked) stays put; heights and vertical positions do not change.',
  },
  'arrange.mirror-across-line': {
    family: 'arrange',
    tooltip:
      'Select the artwork to mirror, then add a straight two-point line to the selection last. A mirrored copy of the artwork appears on the other side of the line; the original and the line stay. Text, images and barcodes stay editable.',
  },
  'arrange.two-point-rotate-scale': {
    family: 'arrange',
    tooltip:
      'Turn the selection about any point: click the pivot, click a reference point, then click where that point should go. Hold Shift on the last click to scale as well. Esc cancels.',
  },
  ...DOCK_HELP,
  'arrange.dock-options': {
    family: 'arrange',
    tooltip:
      'Docking options: the padding left between docked artwork and what it meets, Move as group (the selection moves as one piece), and Lock inner objects (selected artwork inside other selected artwork moves with it). Saved on this computer.',
  },
  'tools.tangent-circle': {
    family: 'tools',
    tooltip:
      'With exactly three circles selected, list every circle that touches all three (outside them, around them, or a mix) and add the one you pick as an ordinary circle. One undo step.',
  },
  'arrange.move-together-vertical': {
    family: 'arrange',
    tooltip:
      'Slide the selected objects or groups up or down until their edges touch, in their current order. The reference (the last one clicked) stays put; horizontal positions do not change.',
  },
};
