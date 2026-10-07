import { useEffect } from 'react';
import { useTerminalCanvasRunInvalidation } from '../laser/terminal-canvas-run-invalidation';
import type { LiveCanvasRun } from './canvas-motion-plan';
import { canvasProgramRunDocumentEpoch } from './canvas-program-source';
import { isActiveJobStatus } from './laser-store-helpers';
import { useLaserStore } from './laser-store';
import { useStore } from './store';

/** A terminal display belongs to its started document, even when the next
 * document has identical bytes or its first idle preparation cannot run. */
export function useCurrentCanvasRun(): LiveCanvasRun | null {
  useTerminalCanvasRunInvalidation();
  const run = useLaserStore((state) => state.liveCanvasRun ?? null);
  const streamerStatus = useLaserStore((state) => state.streamer?.status ?? null);
  const documentEpoch = useStore((state) => state.projectDocumentEpoch);
  const ownerEpoch = run === null ? null : canvasProgramRunDocumentEpoch(run);
  const stale =
    run !== null &&
    !isActiveCanvasLifecycle(run) &&
    !isActiveJobStatus(streamerStatus) &&
    ownerEpoch !== null &&
    ownerEpoch !== documentEpoch;
  useEffect(() => {
    if (!stale || run === null) return;
    const state = useLaserStore.getState();
    if (state.liveCanvasRun === run && !isActiveJobStatus(state.streamer?.status ?? null)) {
      useLaserStore.setState({ liveCanvasRun: null });
    }
  }, [run, stale]);
  return stale ? null : run;
}

export function isActiveCanvasLifecycle(run: LiveCanvasRun): boolean {
  return ['running', 'paused', 'tool-change'].includes(run.lifecycle);
}
