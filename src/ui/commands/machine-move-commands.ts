// Move laser to selection (LightBurn gap LBG-T15, ADR-483): nine Arrange
// commands that send the head, beam off, to the centre, a corner or an edge
// midpoint of the selection. The command only needs a selection; connection,
// Idle, bed mapping and job placement are checked when it runs and explained
// in a toast, because they change far faster than the menu re-renders.

import type { SelectionAnchor } from '../../core/scene';
import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';
import type { MachineMoveCommandId } from './machine-move-command-types';

const NEEDS_SELECTION = 'Select artwork to move the laser to.';

const SELECTION_ANCHORS: ReadonlyArray<{
  readonly id: MachineMoveCommandId;
  readonly anchor: SelectionAnchor;
  readonly label: string;
  readonly where: string;
}> = [
  { id: 'arrange.move-laser-to-selection-center', anchor: 'c', label: 'Center', where: 'centre' },
  {
    id: 'arrange.move-laser-to-selection-nw',
    anchor: 'nw',
    label: 'Top Left',
    where: 'top-left corner',
  },
  {
    id: 'arrange.move-laser-to-selection-n',
    anchor: 'n',
    label: 'Top',
    where: 'top edge, centred',
  },
  {
    id: 'arrange.move-laser-to-selection-ne',
    anchor: 'ne',
    label: 'Top Right',
    where: 'top-right corner',
  },
  {
    id: 'arrange.move-laser-to-selection-w',
    anchor: 'w',
    label: 'Left',
    where: 'left edge, centred',
  },
  {
    id: 'arrange.move-laser-to-selection-e',
    anchor: 'e',
    label: 'Right',
    where: 'right edge, centred',
  },
  {
    id: 'arrange.move-laser-to-selection-sw',
    anchor: 'sw',
    label: 'Bottom Left',
    where: 'bottom-left corner',
  },
  {
    id: 'arrange.move-laser-to-selection-s',
    anchor: 's',
    label: 'Bottom',
    where: 'bottom edge, centred',
  },
  {
    id: 'arrange.move-laser-to-selection-se',
    anchor: 'se',
    label: 'Bottom Right',
    where: 'bottom-right corner',
  },
];

export const MOVE_LASER_TO_SELECTION_IDS: ReadonlyArray<MachineMoveCommandId> =
  SELECTION_ANCHORS.map((entry) => entry.id);

export function machineMoveCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return SELECTION_ANCHORS.map((entry) => {
    const label = `Move Laser to Selection ${entry.label}`;
    const run = (): void => ctx.moveLaserToSelection(entry.anchor);
    return ctx.hasSelection
      ? enabled(
          entry.id,
          'arrange',
          label,
          `Move the head, beam off, to the selection's ${entry.where}`,
          run,
        )
      : disabled(entry.id, 'arrange', label, NEEDS_SELECTION, run);
  });
}
