// Pure resumable passes over a job's program and archive (ADR-337 Amendment
// 1). A yield is a checkpoint between chunks of work, never a decision: the
// synchronous callers drain the same steps in one call, and the window's
// archive runner gives other tasks — Abort, status, streaming — time between
// them. Clock and task scheduling stay outside pure core.
export type WorkSteps<T> = Generator<undefined, T, undefined>;

/** Characters of program text scanned between checkpoints. */
export const TEXT_STEP_CHARS = 1 << 16;

export function runWorkSteps<T>(steps: WorkSteps<T>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** Drains steps: synchronously, or across tasks for a cooperative caller. */
export type WorkStepsRunner = <T>(steps: WorkSteps<T>) => T | Promise<T>;
