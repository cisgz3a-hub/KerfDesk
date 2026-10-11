// use-design-session-persistence — keeps the saved drawing in step with the
// live one (ADR-272 Amendment 3).
//
// Subscribes imperatively rather than through a selector: a drag fires store
// updates every pointer move, and re-rendering the host for each one to decide
// whether to save would be worse than the save. Writes are coalesced on a
// timer so a gesture costs one write, not one per frame, and a final write
// runs at unmount so nothing in flight is lost.

import { useEffect } from 'react';
import { useStore } from '../state';
import { sessionSketch } from './design-session';
import { useDesignStudioStore } from './design-studio-store';
import { writePersistedSession } from './design-session-storage';
import { designRecoveryOwner } from './design-recovery-owner';

// Long enough that a drag coalesces into a single write, short enough that a
// reload moments after drawing still finds the shape.
const SAVE_DEBOUNCE_MS = 400;

export function useDesignSessionPersistence(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const save = (): void => {
      timer = null;
      // The stash holds the drawing while the Studio is closed, so a session
      // that just closed still has something worth saving.
      const state = useDesignStudioStore.getState();
      if (state.documentEpoch !== useStore.getState().projectDocumentEpoch) return;
      const session = state.session ?? state.stash;
      if (session === null) return;
      const projectOwner = designRecoveryOwner(useStore.getState().project);
      writePersistedSession({
        ...(projectOwner === undefined ? {} : { projectOwner }),
        sketch: sessionSketch(session),
        activeLayerId: session.activeLayerId,
        surface3d: session.surface3d,
        applied: session.applied,
        dirtySinceApply: session.dirtySinceApply,
      });
    };

    const scheduleSave = () => {
      if (timer !== null) return;
      timer = setTimeout(save, SAVE_DEBOUNCE_MS);
    };
    const unsubscribe = useDesignStudioStore.subscribe(scheduleSave);
    // Main-workspace edits change the saved project identity even while the
    // Studio drawing is stashed. Keep that same document's recovery owner current.
    const unsubscribeProject = useStore.subscribe((next, previous) => {
      if (
        next.project !== previous.project &&
        next.projectDocumentEpoch === previous.projectDocumentEpoch
      )
        scheduleSave();
    });

    return () => {
      unsubscribe();
      unsubscribeProject();
      if (timer === null) return;
      clearTimeout(timer);
      // A pending write at unmount is the reload case itself — flush it.
      save();
    };
  }, []);
}
