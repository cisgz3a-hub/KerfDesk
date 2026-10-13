// The AppCommandContext slice for the LightBurn parity layout commands: Change
// Draw Order, Make Same Width / Height and Move H / V Together. Folded into the
// batch 5 slice so command-types.ts stays as it is.

import type { DrawOrderMove } from '../../core/draw-order';
import type { SelectionMatchSizeKind } from '../../core/scene/selection-match-size';
import type { SelectionMoveTogetherAxis } from '../../core/scene/selection-move-together';

export type LayoutCommandContext = {
  readonly moveSelectionInDrawOrder: (move: DrawOrderMove) => void;
  readonly matchSelectionSize: (kind: SelectionMatchSizeKind, proportional: boolean) => void;
  readonly moveSelectionTogether: (axis: SelectionMoveTogetherAxis) => void;
};

export type LayoutCommandId =
  | 'arrange.bring-to-front'
  | 'arrange.bring-forward'
  | 'arrange.send-backward'
  | 'arrange.send-to-back'
  | 'arrange.same-width'
  | 'arrange.same-height'
  | 'arrange.same-width-proportional'
  | 'arrange.same-height-proportional'
  | 'arrange.move-together-horizontal'
  | 'arrange.move-together-vertical';
