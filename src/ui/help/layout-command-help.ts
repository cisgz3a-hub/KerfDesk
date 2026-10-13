import type { LayoutCommandId } from '../commands/layout-command-types';
import type { CommandHelpTopic } from './command-help-topics';

const DRAW_ORDER_NOTE =
  'Only what is drawn on top changes; the order the laser cuts in stays as set in the run order.';

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
  'arrange.move-together-vertical': {
    family: 'arrange',
    tooltip:
      'Slide the selected objects or groups up or down until their edges touch, in their current order. The reference (the last one clicked) stays put; horizontal positions do not change.',
  },
};
