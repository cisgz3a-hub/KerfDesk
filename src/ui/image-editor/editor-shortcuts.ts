// Image Studio keymap (ADR-242). The overlay registers as a modal, which
// suppresses ALL app-level shortcuts (including global Ctrl+Z) — so the
// editor owns its keys: editor-local undo/redo, tool hotkeys, brush size,
// selection commands, and Esc (cancel → close with the session kept, F-L1).

import { invertMask, selectAllMask } from '../../core/image-select';
import { useAdjustDialogStore } from './adjust-dialog-store';
import type { EditorTool } from './editor-session';
import { useImageEditorStore } from './image-editor-store';
import { useQuickMaskStore } from './quick-mask-store';

export function handleEditorKeyDown(e: React.KeyboardEvent): void {
  const key = e.key.toLowerCase();
  if (key === ' ') {
    // Held Spacebar = temporary Hand pan (Photoshop convention).
    useImageEditorStore.getState().setSpacePanning(true);
    e.preventDefault();
    return;
  }
  if (handleAdjustDialogKey(e, key)) return;
  if (e.ctrlKey || e.metaKey) {
    if (handleControlKey(key, e.shiftKey)) e.preventDefault();
    return;
  }
  if (handleArrowKey(key, e.shiftKey) || handlePlainKey(key) || handleToolKey(key)) {
    e.preventDefault();
  }
}

// An open adjustment dialog owns the keys: Enter commits, Esc cancels,
// everything else is parked (the dialog's own inputs stop propagation).
function handleAdjustDialogKey(e: React.KeyboardEvent, key: string): boolean {
  const store = useAdjustDialogStore.getState();
  if (store.dialog === null) return false;
  if (key === 'enter') {
    store.commit();
    e.preventDefault();
  } else if (key === 'escape') {
    store.cancel();
    e.preventDefault();
  }
  return true;
}

// Arrows nudge the selection outline 1 px (Shift = 10 px); with the Move
// tool active they move the selected pixels instead (Photoshop).
function handleArrowKey(key: string, shift: boolean): boolean {
  const store = useImageEditorStore.getState();
  if (store.session?.selection == null) return false;
  const step = shift ? 10 : 1;
  const deltas: Readonly<Record<string, readonly [number, number]>> = {
    arrowleft: [-step, 0],
    arrowright: [step, 0],
    arrowup: [0, -step],
    arrowdown: [0, step],
  };
  const delta = deltas[key];
  if (delta === undefined) return false;
  store.nudgeSelection(delta[0], delta[1], store.tool.kind === 'move');
  return true;
}

// [ / ] resize, Shift+[ / Shift+] harden (Photoshop conventions).
function handleBrushSizeKey(key: string): boolean {
  const store = useImageEditorStore.getState();
  switch (key) {
    case '{':
    case '}': {
      const delta = key === '{' ? -0.05 : 0.05;
      store.setBrush({ hardness: Math.min(1, Math.max(0, store.brush.hardness + delta)) });
      return true;
    }
    case '[':
    case ']': {
      const delta = key === '[' ? -2 : 2;
      store.setBrush({ diameterPx: Math.min(256, Math.max(1, store.brush.diameterPx + delta)) });
      return true;
    }
    default:
      return false;
  }
}

function handlePlainKey(key: string): boolean {
  const store = useImageEditorStore.getState();
  if (handleBrushSizeKey(key)) return true;
  switch (key) {
    case 'x':
      store.swapColors();
      return true;
    case 'd':
      store.resetColors();
      return true;
    case 'enter':
      // Enter commits the active modal canvas state: transform, then crop.
      if (store.transform !== null) store.commitTransform();
      else store.commitPendingCrop();
      return true;
    case 'escape':
      // Esc steps outward: transform → cancel; pending crop → discard;
      // non-default tool → Brush; Brush → close (session kept, F-L1).
      if (store.transform !== null) store.cancelTransform();
      else if (store.pendingCrop !== null) store.setPendingCrop(null);
      else if (store.tool.kind !== 'brush') store.setTool({ kind: 'brush' });
      else store.closeEditor();
      return true;
    case 'delete':
    case 'backspace':
      store.deleteSelection();
      return true;
    default:
      return false;
  }
}

export function handleEditorKeyUp(e: React.KeyboardEvent): void {
  if (e.key === ' ') {
    useImageEditorStore.getState().setSpacePanning(false);
    e.preventDefault();
  }
}

const ZOOM_KEY_STEP = 1.25;

// Ctrl+0 fit / Ctrl+1 100% / Ctrl± steps (Photoshop zoom conventions).
function handleZoomKey(key: string): boolean {
  const store = useImageEditorStore.getState();
  switch (key) {
    case '0':
      // Clearing the view makes the canvas re-fit on next layout.
      store.setView(null);
      return true;
    case '1':
      store.zoomTo100();
      return true;
    case '=':
    case '+':
      store.zoomBy(ZOOM_KEY_STEP);
      return true;
    case '-':
      store.zoomBy(1 / ZOOM_KEY_STEP);
      return true;
    default:
      return false;
  }
}

// Ctrl+A all / Ctrl+D deselect / Ctrl+Shift+I inverse (Photoshop trio).
function handleSelectionKey(key: string, shift: boolean): boolean {
  const store = useImageEditorStore.getState();
  const doc = store.session?.doc;
  switch (key) {
    case 'a':
      if (doc !== undefined) store.select(selectAllMask(doc.width, doc.height));
      return true;
    case 'd':
      store.select(null);
      return true;
    case 'i':
      if (shift && store.session?.selection != null) {
        store.select(invertMask(store.session.selection));
        return true;
      }
      return false;
    default:
      return false;
  }
}

function handleControlKey(key: string, shift: boolean): boolean {
  const store = useImageEditorStore.getState();
  if (handleZoomKey(key) || handleSelectionKey(key, shift)) return true;
  switch (key) {
    case 'z':
      if (shift) store.redo();
      else store.undo();
      return true;
    case 'y':
      store.redo();
      return true;
    case 't':
      // Ctrl+T free transform of the selection (or the whole image).
      store.startTransform();
      return true;
    case 'i':
      // Plain Ctrl+I only — Ctrl+Shift+I is Select Inverse above.
      useAdjustDialogStore.getState().open('invert');
      return true;
    case 'l':
      useAdjustDialogStore.getState().open('levels');
      return true;
    case 'm':
      useAdjustDialogStore.getState().open('curves');
      return true;
    case 'u':
      if (!shift) return false;
      useAdjustDialogStore.getState().open('desaturate');
      return true;
    default:
      return false;
  }
}

// M activates the marquee; pressing it again cycles rect ⇄ ellipse (the
// Photoshop flyout-cycle reduction).
function cycledMarquee(tool: EditorTool): EditorTool {
  if (tool.kind !== 'marquee') return { kind: 'marquee', shape: 'rect' };
  return { kind: 'marquee', shape: tool.shape === 'rect' ? 'ellipse' : 'rect' };
}

function handleToolKey(key: string): boolean {
  const store = useImageEditorStore.getState();
  switch (key) {
    case 'b':
      store.setTool({ kind: 'brush' });
      return true;
    case 'p':
      store.setTool({ kind: 'pencil' });
      return true;
    case 'e':
      store.setTool({ kind: 'eraser' });
      return true;
    case 'l':
      store.setTool({ kind: 'line' });
      return true;
    case 'm':
      store.setTool(cycledMarquee(store.tool));
      return true;
    case 'q':
      // Quick Mask: paint the selection as a red rubylith (Photoshop Q).
      useQuickMaskStore.getState().toggle();
      return true;
    case 's':
      store.setTool({ kind: 'lasso' });
      return true;
    case 'w':
      store.setTool({ kind: 'wand' });
      return true;
    case 'c':
      store.setTool({ kind: 'crop' });
      return true;
    case 'v':
      store.setTool({ kind: 'move' });
      return true;
    default:
      return false;
  }
}
