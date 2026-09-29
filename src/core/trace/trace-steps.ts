// Pure resumable computation. A yield is a checkpoint, not an algorithmic
// decision: both runners consume the same steps in the same order. The worker
// drains them synchronously; the UI supplies a runner that gives tasks time.
// A generator's first yield receives the execution mode. Native consumers
// send false, so hot loops run through without allocating checkpoint results;
// cooperative consumers send true to retain checkpoints between work units.
//
// A yield may also carry a TraceReport. Runners that do not show reports treat
// it as one more checkpoint.
export type TraceSteps<T> = Generator<TraceReport | undefined, T, boolean>;

/** What a trace decided on its own, so the Trace dialog can show it. Nothing
 * reads a report back as an input, so reporting cannot change trace output or
 * the options a cached result is keyed on. */
export type TraceReport = {
  /** The luma the automatic (Otsu) threshold cut at, on the image's own
   * brightness: pixels darker than this are ink, so the inclusive manual band
   * that selects the same pixels ends one level lower. */
  readonly automaticThresholdLuma?: number;
  /** The automatic threshold evened out uneven lighting before cutting
   * (ADR-402), so no single brightness band selects what it selected. */
  readonly lightingLevelled?: boolean;
  /** Line Art's automatic detection: true when marks found by local contrast
   * were added to the brightness band, false when the band ran alone. */
  readonly localDetailAdded?: boolean;
};
export type TraceStepRunner = <T>(steps: TraceSteps<T>) => T | Promise<T>;

export function runTraceSteps<T>(steps: TraceSteps<T>): T {
  for (;;) {
    const step = steps.next(false);
    if (step.done) return step.value;
  }
}
