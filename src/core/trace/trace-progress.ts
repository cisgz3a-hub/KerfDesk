/** Actual pipeline boundaries; this is status, not a completion estimate. */
export type TracePhase = 'preparing' | 'tracing' | 'refining';
export type TraceProgress = (phase: TracePhase) => void;

/** Wrap only runner boundaries; preserve its native/cooperative execution mode. */
export function reportingTraceRunner(
  run: TraceStepRunner,
  progress?: TraceProgress,
): TraceStepRunner {
  if (progress === undefined) return run;
  progress('preparing');
  return async (steps) => {
    progress('tracing');
    const result = await run(steps);
    // The caller now restores source coordinates/canonical geometry, then the
    // worker measures bounds and the UI serializes its preview.
    progress('refining');
    return result;
  };
}
import type { TraceStepRunner } from './trace-steps';
