import { useEffect } from 'react';
import { IDLE_DRAG, type EditorDrag } from './editor-drag';
import { useImageEditorStore } from './image-editor-store';

/** Retire held gestures before pointer-up can use a replaced canvas owner. */
export function useEditorGestureRetirement(update: (drag: EditorDrag) => void): void {
  useEffect(
    () =>
      useImageEditorStore.subscribe((state, previous) => {
        if (
          state.tool !== previous.tool ||
          state.session !== previous.session ||
          state.sessionOwner !== previous.sessionOwner ||
          state.pendingCrop !== previous.pendingCrop ||
          (previous.transform !== null && state.transform === null)
        ) {
          // Retire the ref synchronously: Escape followed by pointer-up can
          // arrive before React renders the replacement tool or session.
          update(IDLE_DRAG);
        }
      }),
    [update],
  );
}
