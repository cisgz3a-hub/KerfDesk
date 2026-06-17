// useUnloadStop - best-effort laser-off when the page goes away mid-job.
//
// C3 (AUDIT-2026-06-10): Some jobs still run constant-power M3 moves
// (notably vector cuts and profile-dependent dialects), and any abandoned
// stream can leave the controller armed with buffered motion. The in-app
// Disconnect path already sends a stop before closing the port; this hook
// covers the other abandonment paths: tab close, window close, and navigation
// away.
//
// The page is being torn down, so the write cannot be awaited; initiating the
// soft-reset write is the most WebSerial allows during unload. Both
// `beforeunload` and `pagehide` are registered: beforeunload fires on
// window-close attempts, pagehide on actual navigations (and is the more
// reliable of the two on mobile/bfcache). stopJob is idempotent on the wire; a
// duplicate 0x18 is harmless.

import { useEffect } from 'react';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';

export function installUnloadStop(target: Window): () => void {
  const onUnload = (): void => {
    const state = useLaserStore.getState();
    if (!isActiveJob(state.streamer)) return;
    // Fire-and-forget: a failed write means the port is already gone and
    // nothing more can be done from a dying page.
    void state.stopJob().catch(() => undefined);
  };
  target.addEventListener('beforeunload', onUnload);
  target.addEventListener('pagehide', onUnload);
  return () => {
    target.removeEventListener('beforeunload', onUnload);
    target.removeEventListener('pagehide', onUnload);
  };
}

export function useUnloadStop(): void {
  useEffect(() => installUnloadStop(window), []);
}
