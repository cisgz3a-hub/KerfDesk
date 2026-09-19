// useUnloadStop - best-effort laser-off when the page goes away mid-job.
//
// C3 (AUDIT-2026-06-10): Some jobs still run constant-power M3 moves
// (notably vector cuts and profile-dependent dialects), and any abandoned
// stream can leave the controller armed with buffered motion. The in-app
// Disconnect path already sends a stop before closing the port; this hook
// covers the other abandonment paths: tab close, window close, and navigation
// away.
//
// Web pages cannot await a write during teardown. The Electron shell retains
// its renderer and awaits the application stop handoff before retrying close.
// Both
// `beforeunload` and `pagehide` are registered: beforeunload fires on
// window-close attempts, pagehide on actual navigations (and is the more
// reliable of the two on mobile/bfcache). Both hooks join an outstanding stop;
// they must not reset the controller twice during one pending close.

import { useEffect } from 'react';
import { desktopCloseController, installDesktopCloseReceiver } from './desktop-close-runtime';

export function installUnloadStop(target: Window): () => void {
  const removeReceiver = installDesktopCloseReceiver(target);
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!desktopCloseController.handleBeforeUnload(event)) {
      desktopCloseController.bestEffortStop();
    }
  };
  const onPageHide = (): void => {
    if (!desktopCloseController.ownsUnload) desktopCloseController.bestEffortStop();
  };
  target.addEventListener('beforeunload', onBeforeUnload);
  target.addEventListener('pagehide', onPageHide);
  return () => {
    target.removeEventListener('beforeunload', onBeforeUnload);
    target.removeEventListener('pagehide', onPageHide);
    removeReceiver();
  };
}

export function useUnloadStop(): void {
  useEffect(() => installUnloadStop(window), []);
}
