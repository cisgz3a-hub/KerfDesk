// pen-node-drag — the press-and-drag that shapes the pen node just placed
// (ADR-380). Past a few pixels of travel the node turns smooth and its handle
// follows the pointer, with the opposite handle mirrored; back inside that
// distance it returns to the node the press placed. A pressed first node
// closes the path on release, so a drag there shapes the closing curve.
// https://docs.lightburnsoftware.com/2.1/Reference/DrawLines/

import type { Vec2 } from '../../core/scene';
import type { PenNode } from '../../core/shapes/pen-path';
import { useUiStore } from '../state/ui-store';
import { constrainPenDirection, replacePenNode, type PenDraft } from './pen-draft';

// Travel below this is a click, not a drag, so a slightly unsteady click still
// places a corner.
export const PEN_DRAG_THRESHOLD_PX = 3;

export type PenNodeDragState = {
  readonly kind: 'pen-node';
  readonly nodeIndex: number;
  // The node as the press placed it, restored when the pointer comes back.
  readonly original: PenNode;
  // The draft before the press, restored if the drag is cancelled.
  readonly before: PenDraft | null;
  readonly closeOnRelease: boolean;
  readonly thresholdMm: number;
};

export function penNodeDragUpdate(
  drag: PenNodeDragState,
  pointer: Vec2,
  constrain: boolean,
): PenNode {
  const anchor = drag.original.point;
  const handle = constrain ? constrainPenDirection(anchor, pointer) : pointer;
  const travel = Math.hypot(handle.x - anchor.x, handle.y - anchor.y);
  return travel > drag.thresholdMm
    ? { kind: 'smooth', point: anchor, handleOut: handle }
    : drag.original;
}

export function updatePenNodeDrag(
  drag: PenNodeDragState,
  pointer: Vec2 | null,
  constrain: boolean,
): void {
  const ui = useUiStore.getState();
  if (pointer === null || ui.penDraft === null) return;
  ui.setPenDraft(
    replacePenNode(ui.penDraft, drag.nodeIndex, penNodeDragUpdate(drag, pointer, constrain)),
  );
}

export function cancelPenNodeDrag(drag: PenNodeDragState): void {
  useUiStore.getState().setPenDraft(drag.before);
}
