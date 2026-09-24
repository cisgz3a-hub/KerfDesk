// pen-shortcuts — keys for the Draw Lines (pen) tool (ADR-380), following
// LightBurn: S switches between placing corner and smooth nodes, Backspace or
// Delete removes the last node placed, and Escape finishes the open path.
// Enter keeps finishing through the edit shortcuts. Checked before the edit
// shortcuts so Backspace never deletes the selected artwork mid-drawing, and
// an Escape with nothing to finish falls through to the usual cancel.
// https://docs.lightburnsoftware.com/2.1/Reference/DrawLines/

import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { removeLastPenNode } from '../workspace/pen-draft';
import { finishPen, isPenToolArmed } from '../workspace/pen-tool';

export function handlePenShortcut(e: KeyboardEvent): boolean {
  if (!penKeysLive(e)) return false;
  const ui = useUiStore.getState();
  if (e.key.toLowerCase() === 's' && !e.shiftKey) {
    e.preventDefault();
    if (!e.repeat) ui.togglePenNodeMode();
    return true;
  }
  if (ui.penDraft === null) return false;
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    ui.setPenDraft(removeLastPenNode(ui.penDraft));
    return true;
  }
  if (e.key !== 'Escape') return false;
  const app = useStore.getState();
  if (!finishPen({ closed: false, project: app.project, drawShape: app.drawShape })) return false;
  e.preventDefault();
  return true;
}

function penKeysLive(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || isEditableShortcutTarget(e.target)) return false;
  return isPenToolArmed(useUiStore.getState().toolMode) && !useStore.getState().previewMode;
}
