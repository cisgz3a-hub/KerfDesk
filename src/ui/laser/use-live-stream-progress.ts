// useLiveStreamProgress — the job stream's status and line count, subscribed
// by value and refreshed at a human rate (ADR-333).
//
// The streamer object is replaced on every acknowledgement, so a component
// selecting it by identity re-rendered once per acknowledged line: 400-1500
// times a second during a dense raster, to move a progress bar nobody can read
// at that speed. Worse, those renders land on the same main thread the
// acknowledgement loop needs, so the UI was competing with the flow control
// that keeps the controller's planner fed.
//
// Status is semantic — it flips the Pause/Resume/Continue control and the
// heading — so a status change publishes immediately. The line count is
// cosmetic and publishes at most every REFRESH_MS, always re-read from the
// store at that moment so it can never show a stale figure. The final count is
// not lost: the transition into `done` is itself a status change.

import { useEffect, useRef, useState } from 'react';
import type { StreamerStatus } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import type { LaserState } from '../state/laser-store';

export type LiveStreamProgress = {
  readonly status: StreamerStatus | null;
  readonly completed: number;
  readonly total: number;
};

/** Long enough that a burn cannot flood the renderer, short enough that the
 * bar still looks live. */
const REFRESH_MS = 120;

export function useLiveStreamProgress(): LiveStreamProgress {
  const [value, setValue] = useState<LiveStreamProgress>(() =>
    selectStreamProgress(useLaserStore.getState()),
  );
  const shown = useRef(value);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const publish = (next: LiveStreamProgress): void => {
      shown.current = next;
      setValue(next);
    };
    const observe = (next: LiveStreamProgress): void => {
      if (streamProgressEqual(shown.current, next)) return;
      if (shown.current.status !== next.status) {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        publish(next);
        return;
      }
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        // Re-read rather than publishing the value that scheduled this, so a
        // burst of acknowledgements resolves to the newest count.
        publish(selectStreamProgress(useLaserStore.getState()));
      }, REFRESH_MS);
    };
    // The store may have moved between the first render and this subscription.
    observe(selectStreamProgress(useLaserStore.getState()));
    const unsubscribe = useLaserStore.subscribe((state) => observe(selectStreamProgress(state)));
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  return value;
}

export function selectStreamProgress(state: Pick<LaserState, 'streamer'>): LiveStreamProgress {
  const streamer = state.streamer;
  if (streamer === null) return { status: null, completed: 0, total: 0 };
  return { status: streamer.status, completed: streamer.completed, total: streamer.total };
}

export function streamProgressEqual(a: LiveStreamProgress, b: LiveStreamProgress): boolean {
  return a.status === b.status && a.completed === b.completed && a.total === b.total;
}

/** Percent for a progress readout. A `done` stream is held at 99: every line is
 * acknowledged but the machine is still executing buffered motion. */
export function streamProgressPercent(progress: LiveStreamProgress): number {
  if (progress.status === 'done') return 99;
  if (progress.total <= 0) return 0;
  return Math.round((progress.completed / progress.total) * 100);
}
