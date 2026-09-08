// Pure resumable computation. A yield is a checkpoint, not an algorithmic
// decision: both runners consume the same steps in the same order. The worker
// drains them synchronously; the UI supplies a runner that gives tasks time.
// A generator's first yield receives the execution mode. Native consumers
// send false, so hot loops run through without allocating checkpoint results;
// cooperative consumers send true to retain checkpoints between work units.
export type TraceSteps<T> = Generator<void, T, boolean>;
export type TraceStepRunner = <T>(steps: TraceSteps<T>) => T | Promise<T>;

export function runTraceSteps<T>(steps: TraceSteps<T>): T {
  for (;;) {
    const step = steps.next(false);
    if (step.done) return step.value;
  }
}
