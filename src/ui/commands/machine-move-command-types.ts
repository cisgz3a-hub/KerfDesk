// The AppCommandContext slice for the machine-moving LightBurn gap commands
// (LBG-T15, ADR-493), kept in its own file so command-types.ts stays inside
// the size cap.

import type { SelectionAnchor } from '../../core/scene';

export type MachineMoveCommandContext = {
  readonly moveLaserToSelection: (anchor: SelectionAnchor) => void;
};

export type MachineMoveCommandId =
  | 'arrange.move-laser-to-selection-center'
  | 'arrange.move-laser-to-selection-nw'
  | 'arrange.move-laser-to-selection-n'
  | 'arrange.move-laser-to-selection-ne'
  | 'arrange.move-laser-to-selection-w'
  | 'arrange.move-laser-to-selection-e'
  | 'arrange.move-laser-to-selection-sw'
  | 'arrange.move-laser-to-selection-s'
  | 'arrange.move-laser-to-selection-se';
