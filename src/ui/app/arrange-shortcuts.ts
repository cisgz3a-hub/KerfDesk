// The align, Move Together and draw-order keys (keys and reasons in
// commands/arrange-shortcut-keys.ts). Each runs the same store action as its
// Arrange menu command and names the undo step after it.
//
// A matched chord is always consumed, even when the command is unavailable
// (fewer than two objects to align or move together, nothing to restack): the
// menu item is greyed out then, and the key must not fall through to the
// browser, where Alt+Left and Alt+Right mean Back and Forward. A held key does
// not repeat the command, so one press is one undo step. The draw-order Page
// keys leave a focused list, tab panel or the Artwork panel to scroll.

import type { SelectionAlignKind } from '../../core/scene';
import type { DrawOrderMove } from '../../core/draw-order';
import type { SelectionMoveTogetherAxis } from '../../core/scene/selection-move-together';
import { ALIGN_COMMANDS } from '../commands/arrange-command-family';
import { arrangeShortcutCommandId } from '../commands/arrange-shortcut-keys';
import type { CommandId } from '../commands/command-types';
import { DRAW_ORDER_STEPS, MOVE_TOGETHER_STEPS } from '../commands/layout-commands';
import { selectedObjectIds, selectionUnitCount } from '../commands/selection-command-state';
import { isEditableShortcutTarget, isScrollRegionTarget } from '../common/keyboard-targets';
import { useStore } from '../state/store';
import { withUndoStepName } from '../state/undo-step-names';

export type ArrangeShortcutCtx = {
  readonly canAlign: boolean;
  readonly hasSelection: boolean;
  readonly alignSelection: (kind: SelectionAlignKind) => void;
  readonly moveSelectionTogether: (axis: SelectionMoveTogetherAxis) => void;
  readonly moveSelectionInDrawOrder: (move: DrawOrderMove) => void;
};

// The context is read only for a matched chord, so ordinary typing never pays
// for counting the selection.
export function handleArrangeShortcut(
  e: KeyboardEvent,
  context: () => ArrangeShortcutCtx,
): boolean {
  // A tab strip that already switched tabs on Alt+arrow keeps the key to itself.
  if (isEditableShortcutTarget(e.target) || e.defaultPrevented) return false;
  const id = arrangeShortcutCommandId(e);
  if (id === null) return false;
  if (isDrawOrderKey(id) && isScrollRegionTarget(e.target)) return false;
  e.preventDefault();
  if (!e.repeat) runArrangeCommand(id, context());
  return true;
}

function isDrawOrderKey(id: CommandId): boolean {
  return DRAW_ORDER_STEPS.some((step) => step.id === id);
}

function runArrangeCommand(id: CommandId, ctx: ArrangeShortcutCtx): void {
  const drawOrder = DRAW_ORDER_STEPS.find((step) => step.id === id);
  if (drawOrder !== undefined) {
    if (!ctx.hasSelection) return;
    withUndoStepName(drawOrder.label, () => ctx.moveSelectionInDrawOrder(drawOrder.value));
    return;
  }
  if (!ctx.canAlign) return;
  const align = ALIGN_COMMANDS.find((spec) => spec.id === id);
  if (align !== undefined) {
    withUndoStepName(align.label, () => ctx.alignSelection(align.kind));
    return;
  }
  const together = MOVE_TOGETHER_STEPS.find((step) => step.id === id);
  if (together !== undefined) {
    withUndoStepName(together.label, () => ctx.moveSelectionTogether(together.value));
  }
}

// Groups count once, exactly as for the Arrange menu's enablement.
export function arrangeShortcutContext(): ArrangeShortcutCtx {
  const app = useStore.getState();
  const units = selectionUnitCount(
    app.project,
    selectedObjectIds(app.selectedObjectId, app.additionalSelectedIds),
  );
  return {
    canAlign: units >= 2,
    hasSelection: app.selectedObjectId !== null,
    alignSelection: app.alignSelection,
    moveSelectionTogether: app.moveSelectionTogether,
    moveSelectionInDrawOrder: app.moveSelectionInDrawOrder,
  };
}
