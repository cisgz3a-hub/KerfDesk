// useUnsavedChangesGuard - prompt before discarding unsaved scene edits when the
// window/tab is closed or navigated away (H-U6, AUDIT-2026-06-20-UI-WORKFLOW).
//
// LightBurn prompts to save before exit. The web app silently autosaves to
// localStorage (see useAutosave) but shows no prompt, so an accidental close
// looks like lost work. This adds the native "Leave site? Changes may not be
// saved" confirmation when the scene is dirty.
//
// The browser fallback is deliberately gated OFF during an active job:
// useUnloadStop requests a best-effort Abort in its beforeunload handler, before
// the browser decides whether to honor a prompt. If we blocked unload
// mid-job and the user chose "Stay", the job would already have been stopped.
// So the gate is the exact inverse of useUnloadStop's `isActiveJob` gate: the
// prompt only fires when no unload-stop fires (idle), where the laser-off would
// be a no-op anyway. Browser mid-job unload retains that best-effort behavior.
// Desktop close instead retains the renderer for its application stop handoff,
// then prompts for dirty state before arming a one-use unload approval. Neither
// path claims that software Abort proves the machine physically stopped.

import { useEffect } from 'react';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { desktopCloseController } from './desktop-close-runtime';

export function shouldWarnBeforeUnload(args: {
  readonly dirty: boolean;
  readonly jobActive: boolean;
}): boolean {
  return args.dirty && !args.jobActive;
}

export function installUnsavedChangesGuard(target: Window): () => void {
  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    // Desktop close already made its idle Leave/Stay decision before arming
    // this one-use unload. Active-job close has its separate Abort handoff.
    if (desktopCloseController.handleBeforeUnload(e)) return;
    const dirty = useStore.getState().dirty;
    const jobActive = isActiveJob(useLaserStore.getState().streamer);
    if (!shouldWarnBeforeUnload({ dirty, jobActive })) return;
    // preventDefault triggers the native prompt in modern browsers; the empty
    // returnValue is the legacy belt-and-suspenders some browsers still require.
    e.preventDefault();
    e.returnValue = '';
  };
  target.addEventListener('beforeunload', onBeforeUnload);
  return () => target.removeEventListener('beforeunload', onBeforeUnload);
}

export function useUnsavedChangesGuard(): void {
  useEffect(() => installUnsavedChangesGuard(window), []);
}
