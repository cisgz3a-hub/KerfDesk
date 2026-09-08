import type { TraceStepRunner, TraceSteps } from '../../core/trace/trace-steps';

// Clock and browser task scheduling stay outside pure core. Checkpoints retain
// the algorithm's exact order; only its execution is split across tasks.
const SLICE_MS = 8;

export function createCooperativeTraceRunner(checkCurrent: () => void): TraceStepRunner {
  // Count work before dispatch (including working-grid resampling) in the
  // first slice instead of appending a fresh slice to that same browser task.
  let deadline = performance.now() + SLICE_MS;
  return async <T>(steps: TraceSteps<T>): Promise<T> => {
    try {
      for (;;) {
        checkCurrent();
        if (performance.now() >= deadline) {
          // A timer task lets input/rendering run; a Promise-only microtask
          // would immediately continue computation on the same blocked turn.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          checkCurrent();
          deadline = performance.now() + SLICE_MS;
        }
        const step = steps.next(true);
        if (step.done) return step.value;
      }
    } finally {
      // Close suspended generator frames on supersession or failure.
      steps.return(undefined as never);
    }
  };
}
