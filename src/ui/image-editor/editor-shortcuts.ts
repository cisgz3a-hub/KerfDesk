// Image Studio keymap (ADR-242). The overlay registers as a modal, which
// suppresses ALL app-level shortcuts (including global Ctrl+Z) — so the
// editor owns its keys: editor-local undo/redo, tool hotkeys, brush size,
// selection commands, and Esc (cancel → close with the session kept, F-L1).

import { invertMask, selectAllMask } from '../../core/image-select';
import { useImageEditorStore } from './image-editor-store';

export function handleEditorKeyDown(e: React.KeyboardEvent): void {
  const store = useImageEditorStore.getState();
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (handleControlKey(key, e.shiftKey)) e.preventDefault();
    return;
  }
  if (key === 'escape') {
    // Esc steps outward: non-default tool → Brush; Brush → close (session
    // kept — closing never asks anything, F-L1).
    if (store.tool.kind !== 'brush') store.setTool({ kind: 'brush' });
    else store.closeEditor();
    e.preventDefault();
    return;
  }
  if (key === 'delete' || key === 'backspace') {
    store.deleteSelection();
    e.preventDefault();
    return;
  }
  if (key === '[' || key === ']') {
    const delta = key === '[' ? -2 : 2;
    store.setBrush({ diameterPx: Math.min(256, Math.max(1, store.brush.diameterPx + delta)) });
    e.preventDefault();
    return;
  }
  if (handleToolKey(key)) e.preventDefault();
}

function handleControlKey(key: string, shift: boolean): boolean {
  const store = useImageEditorStore.getState();
  const doc = store.session?.doc;
  switch (key) {
    case 'z':
      if (shift) store.redo();
      else store.undo();
      return true;
    case 'y':
      store.redo();
      return true;
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
      store.setTool({ kind: 'marquee' });
      return true;
    case 's':
      store.setTool({ kind: 'lasso' });
      return true;
    case 'w':
      store.setTool({ kind: 'wand' });
      return true;
    case 'v':
      store.setTool({ kind: 'move' });
      return true;
    default:
      return false;
  }
}
