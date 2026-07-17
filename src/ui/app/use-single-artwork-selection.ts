// ADR-222: default-select a scene's only selectable artwork when that
// one-artwork state begins. Manual deselection remains authoritative: Escape,
// an empty-canvas click, or a marquee miss must not immediately re-mark it.

import { useEffect } from 'react';
import { useStore } from '../state';
import { loneSelectableArtworkId } from '../state/lone-selectable-artwork';

/** Select the scene's only artwork when nothing is selected (ADR-222). */
export function selectLoneArtwork(expectedId?: string): void {
  const state = useStore.getState();
  if (state.selectedObjectId !== null || state.additionalSelectedIds.size > 0) return;
  const id = loneSelectableArtworkId(state.project.scene);
  if (id !== null && (expectedId === undefined || id === expectedId)) state.selectObject(id);
}

/** Select once when the scene enters a one-selectable-artwork state. */
export function useSingleArtworkSelection(): void {
  useEffect(() => {
    selectLoneArtwork();
    return useStore.subscribe((state, previous) => {
      if (state.project === previous.project) return;
      const id = loneSelectableArtworkId(state.project.scene);
      const previousId = loneSelectableArtworkId(previous.project.scene);
      if (id === null || id === previousId) return;
      // Defer out of the current store notification and guard against a second
      // scene change landing before this microtask runs.
      queueMicrotask(() => selectLoneArtwork(id));
    });
  }, []);
}
