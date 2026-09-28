import type { MachineMoveCommandId } from '../commands/machine-move-command-types';
import type { CommandHelpTopic } from './command-help-topics';

// Move laser to selection (LightBurn gap LBG-T15, ADR-493).
const WHERE: Readonly<Record<MachineMoveCommandId, string>> = {
  'arrange.move-laser-to-selection-center': 'the centre of the selection',
  'arrange.move-laser-to-selection-nw': 'the top-left corner of the selection',
  'arrange.move-laser-to-selection-n': 'the middle of the selection’s top edge',
  'arrange.move-laser-to-selection-ne': 'the top-right corner of the selection',
  'arrange.move-laser-to-selection-w': 'the middle of the selection’s left edge',
  'arrange.move-laser-to-selection-e': 'the middle of the selection’s right edge',
  'arrange.move-laser-to-selection-sw': 'the bottom-left corner of the selection',
  'arrange.move-laser-to-selection-s': 'the middle of the selection’s bottom edge',
  'arrange.move-laser-to-selection-se': 'the bottom-right corner of the selection',
};

export const MACHINE_MOVE_COMMAND_HELP = Object.fromEntries(
  Object.entries(WHERE).map(([id, where]) => [
    id,
    {
      family: 'arrange',
      tooltip: `Move the head, beam off, to ${where}: the spot where an Absolute Coords job burns it. Needs a connected, idle machine; in other Start From modes, Frame shows where the job burns.`,
    },
  ]),
) as Readonly<Record<MachineMoveCommandId, CommandHelpTopic>>;
