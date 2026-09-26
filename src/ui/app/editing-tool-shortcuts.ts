// Keyboard shortcuts for the LightBurn gap batch 3 editing tools (ADR-410),
// kept beside shortcuts.ts so that file stays inside the size cap.
//
//   . / ,          Rotate the selection 90° clockwise / counter-clockwise
//   Ctrl+Shift+V   Paste in Place
//   Ctrl+Shift+I   Invert Selection
//   Alt+W          Filled / Wireframe view
//
// Plain '.' never collides with Abort: Abort is Ctrl/Cmd+. and this handler
// ignores any chord with Ctrl or Cmd held.

import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import type { QuarterTurnDirection } from '../../core/scene/selection-placement';

export type EditingToolCtx = {
  readonly hasSelection: boolean;
  readonly rotateSelectionQuarterTurn: (direction: QuarterTurnDirection) => void;
  readonly pasteClipboardInPlace: () => void;
  readonly invertSelection: () => void;
  readonly toggleWireframeView: () => void;
};

const ROTATE_KEYS: Readonly<Record<string, QuarterTurnDirection>> = { '.': 1, ',': -1 };

export function handleEditingToolShortcut(e: KeyboardEvent, ctx: EditingToolCtx): boolean {
  if (isEditableShortcutTarget(e.target)) return false;
  return tryRotate(e, ctx) || tryShiftChord(e, ctx) || tryWireframe(e, ctx);
}

function hasMeta(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

function tryRotate(e: KeyboardEvent, ctx: EditingToolCtx): boolean {
  const direction = ROTATE_KEYS[e.key];
  if (direction === undefined || hasMeta(e) || e.altKey || !ctx.hasSelection) return false;
  return run(e, () => ctx.rotateSelectionQuarterTurn(direction));
}

// Ctrl/Cmd+Shift+V pastes in place; Ctrl/Cmd+Shift+I inverts the selection.
function tryShiftChord(e: KeyboardEvent, ctx: EditingToolCtx): boolean {
  if (!hasMeta(e) || !e.shiftKey || e.altKey) return false;
  const key = e.key.toLowerCase();
  if (key === 'v') return run(e, ctx.pasteClipboardInPlace);
  if (key === 'i') return run(e, ctx.invertSelection);
  return false;
}

// e.code keeps Alt+W working on macOS, where Option+W types a symbol.
function tryWireframe(e: KeyboardEvent, ctx: EditingToolCtx): boolean {
  if (!e.altKey || hasMeta(e) || e.shiftKey) return false;
  if (e.code !== 'KeyW' && e.key.toLowerCase() !== 'w') return false;
  return run(e, ctx.toggleWireframeView);
}

function run(e: KeyboardEvent, action: () => void): true {
  e.preventDefault();
  action();
  return true;
}

export function editingToolShortcutContext(): EditingToolCtx {
  const app = useStore.getState();
  return {
    hasSelection: app.selectedObjectId !== null,
    rotateSelectionQuarterTurn: app.rotateSelectionQuarterTurn,
    pasteClipboardInPlace: app.pasteClipboardInPlace,
    invertSelection: app.invertSelection,
    toggleWireframeView: () => useUiStore.getState().toggleWireframeView(),
  };
}
