// design-studio-shell-link — connects the loaded session store to the boot-side
// shell (design-studio-shell.ts, ADR-272 Amendment 9). It lives with the store
// in the lazy runtime chunk; the shell never imports it.

import type { StoreApi } from 'zustand';
import { useStore } from '../state';
import { sessionSketch } from './design-session';
import type { DesignStudioState } from './design-studio-store';
import { registerDesignStudioRuntime, setDesignStudioSessionOpen } from './design-studio-shell';

type StudioDrawing = Pick<DesignStudioState, 'documentEpoch' | 'session' | 'stash'>;

/** True while the Studio, open or closed, holds shapes drawn since the last
 *  Apply for the current project (ADR-590 Amendment 1). */
export function studioHoldsUnappliedDrawing(studio: StudioDrawing): boolean {
  if (studio.documentEpoch !== useStore.getState().projectDocumentEpoch) return false;
  const session = studio.session ?? studio.stash;
  return session !== null && session.dirtySinceApply && sessionSketch(session).entities.length > 0;
}

/** Registers the store with the shell and keeps the shell's "open" flag in step. */
export function linkDesignStudioShell(store: StoreApi<DesignStudioState>): void {
  // Late-bound, so an action replaced on the state (a test spy) is the one called.
  registerDesignStudioRuntime({
    openStudio: () => store.getState().openStudio(),
    closeStudio: () => store.getState().closeStudio(),
    holdsUnappliedDrawing: () => studioHoldsUnappliedDrawing(store.getState()),
  });
  setDesignStudioSessionOpen(store.getState().session !== null);
  store.subscribe((state) => setDesignStudioSessionOpen(state.session !== null));
}
