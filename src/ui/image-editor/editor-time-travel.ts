// History-panel time travel (ADR-242, PP-F): jump the session to any listed
// state by replaying the tile-CoW undo/redo steps. Each step is exactly
// reversible (history.ts captures the counterpart before restoring), so a
// jump is just N sequential steps — no special state model needed.

import { useImageEditorStore } from './image-editor-store';
import { redoSession, undoSession, type EditorSession } from './editor-session';

export type HistoryTarget =
  /** Before the first recorded op (undo everything). */
  | { readonly kind: 'open' }
  /** After undoStack[index] — index 0 is the oldest recorded op. */
  | { readonly kind: 'past'; readonly index: number }
  /** A redoable step; 0 = the nearest future (top of the redo stack). */
  | { readonly kind: 'future'; readonly index: number };

export function jumpToHistoryState(session: EditorSession, target: HistoryTarget): EditorSession {
  const undoTimes =
    target.kind === 'open'
      ? session.history.undoStack.length
      : target.kind === 'past'
        ? session.history.undoStack.length - 1 - target.index
        : 0;
  const redoTimes = target.kind === 'future' ? target.index + 1 : 0;
  let current = session;
  for (let i = 0; i < undoTimes; i += 1) current = undoSession(current);
  for (let i = 0; i < redoTimes; i += 1) current = redoSession(current);
  return current;
}

/** Store-connected form the panel buttons call. */
export function jumpEditorHistory(target: HistoryTarget): void {
  const { session } = useImageEditorStore.getState();
  if (session === null) return;
  useImageEditorStore.setState({ session: jumpToHistoryState(session, target) });
}
