// Keyboard shortcuts for the LightBurn gap batch 3 editing tools (ADR-410),
// kept beside shortcuts.ts so that file stays inside the size cap. The keys are
// LightBurn's (Windows hotkey cheatsheet Rev 2.0, ADR-410 Amendment 4):
//
//   . / ,                  Rotate the selection 90° clockwise / counter-clockwise
//   Shift+. / Shift+,      Rotate 45°
//   Ctrl+Shift+. / ,       Rotate 1.5°
//   Ctrl+Shift+H / V       Flip horizontal / vertical (bare H / V also flip)
//   Alt+V                  Paste in Place
//   Ctrl+Shift+I           Invert Selection
//   Alt+W                  Filled / Wireframe view
//   Alt+D                  Delete Duplicates (batch 5, ADR-480; LightBurn's key)
//
// LightBurn's 15° keys, Ctrl+. and Ctrl+, are KerfDesk's Abort and Settings, and
// stay so. Plain '.' never collides with Abort: Abort is Ctrl/Cmd+. and the 90°
// keys ignore any chord with Ctrl or Cmd held. The 45° and 1.5° keys go by the
// physical key, and never by a key that types '.' or ',': on a layout where
// Shift on that key types a full stop or comma, the chord stays the 90° turn,
// Abort or Settings, whichever it was.

import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { isAltLetterChord } from './shortcuts';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { namedUndoAction, withUndoStepName } from '../state/undo-step-names';
import type { SelectionFlipAxis } from '../../core/scene';
import type { QuarterTurnDirection } from '../../core/scene/selection-placement';

export type EditingToolCtx = {
  readonly hasSelection: boolean;
  readonly rotateSelectionQuarterTurn: (direction: QuarterTurnDirection) => void;
  /** Turns the selection by `deltaDeg`, clockwise on screen when positive. */
  readonly rotateSelectionBy: (deltaDeg: number) => void;
  readonly flipSelection: (axis: SelectionFlipAxis) => void;
  readonly pasteClipboardInPlace: () => void;
  readonly invertSelection: () => void;
  readonly toggleWireframeView: () => void;
  readonly deleteDuplicates: () => void;
};

const ROTATE_KEYS: Readonly<Record<string, QuarterTurnDirection>> = { '.': 1, ',': -1 };
const ROTATE_STEP_CODES: Readonly<Record<string, QuarterTurnDirection>> = {
  Period: 1,
  Comma: -1,
};
const SHIFT_ROTATE_DEG = 45;
const CTRL_SHIFT_ROTATE_DEG = 1.5;

export function handleEditingToolShortcut(e: KeyboardEvent, ctx: EditingToolCtx): boolean {
  if (isEditableShortcutTarget(e.target)) return false;
  return (
    tryRotate(e, ctx) ||
    tryRotateStep(e, ctx) ||
    tryShiftChord(e, ctx) ||
    tryPasteInPlace(e, ctx) ||
    tryWireframe(e, ctx) ||
    tryDeleteDuplicates(e, ctx)
  );
}

function hasMeta(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

function tryRotate(e: KeyboardEvent, ctx: EditingToolCtx): boolean {
  const direction = ROTATE_KEYS[e.key];
  if (direction === undefined || hasMeta(e) || e.altKey || !ctx.hasSelection) return false;
  return run(e, () => ctx.rotateSelectionQuarterTurn(direction));
}

// Shift+. / Shift+, turn 45°, and with Ctrl/Cmd as well 1.5°, as in LightBurn.
function tryRotateStep(e: KeyboardEvent, ctx: EditingToolCtx): boolean {
  const direction = ROTATE_STEP_CODES[e.code];
  if (direction === undefined || !e.shiftKey || e.altKey || !ctx.hasSelection) return false;
  if (ROTATE_KEYS[e.key] !== undefined) return false;
  const stepDeg = hasMeta(e) ? CTRL_SHIFT_ROTATE_DEG : SHIFT_ROTATE_DEG;
  return run(e, () => ctx.rotateSelectionBy(direction * stepDeg));
}

// Ctrl/Cmd+Shift+H / V flip, LightBurn's Arrange keys; Ctrl/Cmd+Shift+I inverts
// the selection. A flip chord is consumed with nothing selected too, so it never
// falls through to the browser (Firefox opens its history on Ctrl+Shift+H).
function tryShiftChord(e: KeyboardEvent, ctx: EditingToolCtx): boolean {
  if (!hasMeta(e) || !e.shiftKey || e.altKey) return false;
  const key = e.key.toLowerCase();
  if (key === 'h' || key === 'v') {
    const axis: SelectionFlipAxis = key === 'h' ? 'horizontal' : 'vertical';
    return run(e, () => {
      if (ctx.hasSelection) ctx.flipSelection(axis);
    });
  }
  if (key === 'i') return run(e, ctx.invertSelection);
  return false;
}

// Alt/Option+V, LightBurn's Paste in Place.
function tryPasteInPlace(e: KeyboardEvent, ctx: EditingToolCtx): boolean {
  if (!isAltLetterChord(e, 'v')) return false;
  return run(e, ctx.pasteClipboardInPlace);
}

// Alt/Option+W, read the way every Alt-letter chord is (shortcuts.ts), so it
// also works on macOS, where Option+W types a symbol.
function tryWireframe(e: KeyboardEvent, ctx: EditingToolCtx): boolean {
  if (!isAltLetterChord(e, 'w')) return false;
  return run(e, ctx.toggleWireframeView);
}

function tryDeleteDuplicates(e: KeyboardEvent, ctx: EditingToolCtx): boolean {
  if (!isAltLetterChord(e, 'd')) return false;
  return run(e, ctx.deleteDuplicates);
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
    // The same Undo-list names as the Arrange and Edit menu commands.
    rotateSelectionQuarterTurn: (direction) =>
      withUndoStepName(
        direction === 1 ? 'Rotate 90° Clockwise' : 'Rotate 90° Counter-clockwise',
        () => app.rotateSelectionQuarterTurn(direction),
      ),
    rotateSelectionBy: (deltaDeg) =>
      withUndoStepName(
        `Rotate ${Math.abs(deltaDeg)}° ${deltaDeg > 0 ? 'Clockwise' : 'Counter-clockwise'}`,
        () => app.rotateSelectionBy(deltaDeg),
      ),
    flipSelection: (axis) =>
      withUndoStepName(axis === 'horizontal' ? 'Flip Horizontal' : 'Flip Vertical', () =>
        app.flipSelection(axis),
      ),
    pasteClipboardInPlace: namedUndoAction('Paste in Place', app.pasteClipboardInPlace),
    invertSelection: app.invertSelection,
    toggleWireframeView: () => useUiStore.getState().toggleWireframeView(),
    deleteDuplicates: namedUndoAction('Delete Duplicates', app.deleteDuplicates),
  };
}
