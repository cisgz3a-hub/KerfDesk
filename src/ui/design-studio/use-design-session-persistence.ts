// use-design-session-persistence — keeps the saved drawing in step with the
// live one (ADR-272 Amendment 3).
//
// Subscribes imperatively rather than through a selector: a drag fires store
// updates every pointer move, and re-rendering the host for each one to decide
// whether to save would be worse than the save. Writes are coalesced on a
// timer so a gesture costs one write, not one per frame, and a final write
// runs at unmount so nothing in flight is lost.

import { useEffect } from 'react';
import { sessionSketch } from './design-session';
import { useDesignStudioStore } from './design-studio-store';
import { writePersistedSession } from './design-session-storage';

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
      const session = state.session ?? state.stash;
      if (session === null) return;
      writePersistedSession({
        sketch: sessionSketch(session),
        activeLayerId: session.activeLayerId,
        surface3d: session.surface3d,
        applied: session.applied,
      });
    };

    const unsubscribe = useDesignStudioStore.subscribe(() => {
      if (timer !== null) return;
      timer = setTimeout(save, SAVE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timer === null) return;
      clearTimeout(timer);
      // A pending write at unmount is the reload case itself — flush it.
      save();
    };
  }, []);
}
