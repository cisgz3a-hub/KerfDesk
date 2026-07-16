// ADR-222: a scene whose only artwork is selectable keeps that artwork
// selected. Deselect (Escape / empty-canvas click / marquee miss), Open, New,
// undo/redo, and delete-down-to-one all funnel through the store, so one
// App-mounted subscription re-marks the lone artwork whenever the selection
// empties — the same pattern usePolylineFairingUpgrade uses.

import { useEffect } from 'react';
import { useStore } from '../state';
import { loneSelectableArtworkId } from '../state/lone-selectable-artwork';

/** Select the scene's only artwork when nothing is selected (ADR-222). */
export function selectLoneArtwork(): void {
  const state = useStore.getState();
  if (state.selectedObjectId !== null || state.additionalSelectedIds.size > 0) return;
  const id = loneSelectableArtworkId(state.project.scene);
  if (id !== null) state.selectObject(id);
}

/** Keep the scene's only artwork marked (selected) by default. */
export function useSingleArtworkSelection(): void {
  useEffect(() => {
    selectLoneArtwork();
    return useStore.subscribe((state, previous) => {
      const selectionOrSceneChanged =
        state.project !== previous.project ||
        state.selectedObjectId !== previous.selectedObjectId ||
        state.additionalSelectedIds !== previous.additionalSelectedIds;
      // Microtask so we never setState inside another set's notify cycle
      // (matches usePolylineFairingUpgrade). Re-entry is bounded: the
      // follow-up selection change re-notifies once and then no-ops.
      if (selectionOrSceneChanged) queueMicrotask(selectLoneArtwork);
    });
  }, []);
}
