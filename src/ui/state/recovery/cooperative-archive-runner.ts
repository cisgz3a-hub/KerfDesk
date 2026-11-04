// Drains a running job's archive steps across browser tasks (ADR-337
// Amendment 1).
//
// ADR-337 builds and stores the execution archive once the controller has
// accepted the program, so the job is already running when it starts. Abort,
// status and any window-side streaming share this thread, and the running-job
// budget for one task is 50 ms. A slice runs steps for ARCHIVE_SLICE_MS and
// then resumes on a later task, after input, rendering and the stream had
// their turn. Every step still runs once and in order; only the task it runs
// in changes, so the archive is the one a single call would build.
//
// MessageChannel rather than a timer: nested timers clamp to 4 ms and hidden
// windows throttle them, which would only make the archive finish later.

import type { WorkSteps, WorkStepsRunner } from '../../../core/recovery';

/** Longest stretch of archive work one task may run before yielding. */
export const ARCHIVE_SLICE_MS = 8;

export type CooperativeArchiveRunner = {
  readonly run: WorkStepsRunner;
  /** Release the channel; pending yields resolve so no caller is stranded. */
  readonly close: () => void;
};

export function createCooperativeArchiveRunner(
  now: () => number = () => performance.now(),
): CooperativeArchiveRunner {
  const nextTask = createNextTask();
  let sliceStartedAt = now();
  const run = async <T>(steps: WorkSteps<T>): Promise<T> => {
    for (;;) {
      if (now() - sliceStartedAt >= ARCHIVE_SLICE_MS) {
        await nextTask.next();
        sliceStartedAt = now();
      }
      const step = steps.next();
      if (step.done) return step.value;
    }
  };
  return { run, close: nextTask.close };
}

type NextTask = {
  readonly next: () => Promise<void>;
  readonly close: () => void;
};

const timerTask = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

function createNextTask(): NextTask {
  if (typeof MessageChannel !== 'function') return { next: timerTask, close: () => undefined };
  const channel = new MessageChannel();
  let closed = false;
  let waiters: (() => void)[] = [];
  const release = (): void => {
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  };
  channel.port1.onmessage = release;
  // Node (tests) keeps a listening port alive; browsers have no unref.
  unref(channel.port1);
  unref(channel.port2);
  return {
    next: () => {
      // A closed channel delivers nothing; a late caller still gets a task.
      if (closed) return timerTask();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        channel.port2.postMessage(null);
      });
    },
    close: () => {
      closed = true;
      channel.port1.close();
      channel.port2.close();
      release();
    },
  };
}

function unref(port: MessagePort): void {
  (port as MessagePort & { unref?: () => void }).unref?.();
}
