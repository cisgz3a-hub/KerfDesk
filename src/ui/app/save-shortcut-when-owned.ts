// Ctrl/Cmd+S while a dialog, a Studio or on-canvas text owns the keyboard.
//
// ADR-242 and ADR-272 hand the keyboard to an open modal, so the workspace's
// Save shortcut stands down there. It used to stand down before consuming the
// key: on the desktop nothing happened, and in a browser the key fell through
// to "Save page as" (annoyance audit A4-P2-6). The key is now always consumed,
// and one keyed line says what to do first. Nothing is saved from here: a
// Studio session that has not been applied is not in the project yet, and a
// save now would write the project without it while looking like a full save.
//
// The listener runs in the window's capture phase because some dialogs stop
// every keydown they get, which a bubble listener never hears.

import { keyboardOwnedElsewhere } from '../common/keyboard-owner';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { useToastStore } from '../state/toast-store';
import { useCanvasTextStore } from '../text/canvas-text-store';

export const SAVE_BLOCKED_MESSAGES = {
  designStudio: 'Not saved yet. Apply the drawing and close Design Studio, then save the project.',
  imageStudio: 'Not saved yet. Apply the image and close the Studio, then save the project.',
  canvasText: 'Not saved yet. Finish the text, then save the project.',
  dialog: 'Not saved yet. Close this window, then save the project.',
} as const;

const SAVE_BLOCKED_KEY = 'save-blocked-by-keyboard-owner';

function isSaveChord(event: KeyboardEvent): boolean {
  // Ctrl+Alt is AltGr on many layouts, and types a character there.
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's';
}

function saveBlockedMessage(): string {
  if (useCanvasTextStore.getState().session !== null) return SAVE_BLOCKED_MESSAGES.canvasText;
  // Image Studio can sit inside Design Studio's Photos tab, so it is asked first.
  if (useImageEditorStore.getState().session !== null) return SAVE_BLOCKED_MESSAGES.imageStudio;
  if (designStudioOpen()) return SAVE_BLOCKED_MESSAGES.designStudio;
  return SAVE_BLOCKED_MESSAGES.dialog;
}

// Design Studio loads as its own chunk on first open. Its store is not part of
// the boot bundle and must not become so for one toast, so the open overlay is
// read from the page (DesignStudioOverlay's role and name).
function designStudioOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-label="Design Studio"]') !== null;
}

/** Consumes Save and Save As while the workspace does not own the keyboard. */
export function handleSaveShortcutWhenOwned(event: KeyboardEvent): boolean {
  if (!isSaveChord(event) || !keyboardOwnedElsewhere()) return false;
  event.preventDefault();
  if (!event.repeat) {
    useToastStore.getState().pushToast(saveBlockedMessage(), 'info', { key: SAVE_BLOCKED_KEY });
  }
  return true;
}

export function installSaveShortcutWhenOwned(target: Window): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    handleSaveShortcutWhenOwned(event);
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
