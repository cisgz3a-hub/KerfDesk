// The align and distribute keys (keys and reasons in
// commands/arrange-shortcut-keys.ts). Each runs the same store action as its
// Arrange menu command and names the undo step after it.
//
// A matched chord is always consumed, even when the command is unavailable
// (fewer than two objects to align, three to distribute): the menu item is
// greyed out then, and the key must not fall through to the browser, where
// Alt+Left and Alt+Right mean Back and Forward. A held key does not repeat the
// command, so one press is one undo step.

import type { SelectionAlignKind, SelectionDistributeKind } from '../../core/scene';
import { ALIGN_COMMANDS, DISTRIBUTE_COMMANDS } from '../commands/arrange-command-family';
import { arrangeShortcutCommandId } from '../commands/arrange-shortcut-keys';
import { selectedObjectIds, selectionUnitCount } from '../commands/selection-command-state';
import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { useStore } from '../state/store';
import { withUndoStepName } from '../state/undo-step-names';

export type ArrangeShortcutCtx = {
  readonly canAlign: boolean;
  readonly canDistribute: boolean;
  readonly alignSelection: (kind: SelectionAlignKind) => void;
  readonly distributeSelection: (kind: SelectionDistributeKind) => void;
};

// The context is read only for a matched chord, so ordinary typing never pays
// for counting the selection.
export function handleArrangeShortcut(
  e: KeyboardEvent,
  context: () => ArrangeShortcutCtx,
): boolean {
  if (isEditableShortcutTarget(e.target)) return false;
  const id = arrangeShortcutCommandId(e);
  if (id === null) return false;
  e.preventDefault();
  if (e.repeat) return true;
  const ctx = context();
  const align = ALIGN_COMMANDS.find((spec) => spec.id === id);
  if (align !== undefined) {
    if (ctx.canAlign) withUndoStepName(align.label, () => ctx.alignSelection(align.kind));
    return true;
  }
  const distribute = DISTRIBUTE_COMMANDS.find((spec) => spec.id === id);
  if (distribute !== undefined && ctx.canDistribute) {
    withUndoStepName(distribute.label, () => ctx.distributeSelection(distribute.kind));
  }
  return true;
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
    canDistribute: units >= 3,
    alignSelection: app.alignSelection,
    distributeSelection: app.distributeSelection,
  };
}
