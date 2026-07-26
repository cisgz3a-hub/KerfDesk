import { useEffect, useState } from 'react';
import { useLaserStore } from '../state/laser-store';
import { describeLiveJobTiming } from '../state/live-job-timing';
import { JobTimeBadge, type JobTimeBadgeState } from './JobTimeBadge';
import { EstimateBadge } from './JobEstimatePresentation';
import type { LiveJobEstimate } from './live-job-estimate';

const CLOCK_TICK_MS = 1_000;

export function LiveJobTimeBadge({
  estimate,
}: {
  readonly estimate: LiveJobEstimate;
}): JSX.Element | null {
  const run = useLaserStore((state) => state.liveCanvasRun ?? null);
  const [now, setNow] = useState(() => Date.now());
  const isTicking = run?.timing?.kind === 'running' || run?.timing?.kind === 'estimating';

  useEffect(() => {
    setNow(Date.now());
  }, [run?.lifecycle, run?.timing]);
  useEffect(() => {
    if (!isTicking) return undefined;
    const handle = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(handle);
  }, [isTicking]);

  if (run === null) return <EstimateBadge estimate={estimate} />;
  const state = badgeState(run, now);
  return <JobTimeBadge state={state} />;
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
