import { useEffect, useState } from 'react';
import { useLaserStore } from '../state/laser-store';
import { describeLiveJobTiming } from '../state/live-job-timing';
import { JobTimeBadge, type JobTimeBadgeState } from './JobTimeBadge';
import { EstimateBadge } from './JobEstimatePresentation';
import type { LiveJobEstimate } from './live-job-estimate';

const CLOCK_TICK_MS = 1_000;

/**
 * Shows the prepared estimate before a run, then switches to the active run's
 * exact-program timing state without treating acknowledged lines as elapsed time.
 */
export function LiveJobTimeBadge({
  estimate,
}: {
  readonly estimate: LiveJobEstimate;
}): JSX.Element | null {
  const run = useLaserStore((state) => state.liveCanvasRun ?? null);
  const isTicking = run?.timing?.kind === 'running' || run?.timing?.kind === 'estimating';
  useClockTick(isTicking);

  if (run === null) return <EstimateBadge estimate={estimate} />;
  // Read the clock while rendering. A timing update (one per status poll
  // during a run) used to commit with the previous tick's time and then again
  // from an effect that refreshed it: two commits per poll for one readout.
  const state = badgeState(run, Date.now());
  return <JobTimeBadge state={state} />;
}

// Re-renders once a second while the countdown is live; the render reads the
// time itself, so the tick carries no value.
function useClockTick(isTicking: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isTicking) return undefined;
    const handle = setInterval(() => setTick((tick) => tick + 1), CLOCK_TICK_MS);
    return () => clearInterval(handle);
  }, [isTicking]);
}

function badgeState(
  run: ReturnType<typeof useLaserStore.getState>['liveCanvasRun'],
  now: number,
): JobTimeBadgeState {
  if (run?.timing !== undefined) return describeLiveJobTiming(run.timing, now);
  return {
    kind: 'unavailable',
    reason: 'exact emitted-program timing was not prepared',
  };
}
