// Bounds how long one browser task spends handing controller output to the app
// (ADR-356).
//
// The main-thread transport reads the port with `await reader.read()` and hands
// each line to the app synchronously: the acknowledgement, the refill write, the
// store update and every subscriber run inside that call. When the host falls
// behind the controller - any main-thread stall while the machine keeps
// answering - Chromium holds up to SERIAL_BUFFER_BYTES of its output, about a
// thousand `ok` lines. A read whose chunk is already queued resolves as a
// microtask, so that backlog, and whatever the controller answered while it was
// being processed, ran as one task: no input, no rendering, no status poll.
// Late in a large job that task could outlast Chrome's 15 s hang monitor.
//
// A slice lets one task dispatch lines for READ_LOOP_SLICE_MS and then resumes
// on a later task. Every line is still dispatched once and in wire order; only
// the task it runs in changes. Idle reads never spend the budget: a read that
// resolves on a later task starts a fresh slice. MessageChannel rather than a
// timer, because hidden tabs throttle timers and a stream must not slow down.

/** Longest stretch of line dispatch one task may run before yielding. */
export const READ_LOOP_SLICE_MS = 8;

export type ReadSlice = {
  /** Call when a read resolves: a later task than the slice's start gets a fresh budget. */
  readonly resumed: () => void;
  /** True once this task has dispatched lines for the whole budget. */
  readonly spent: () => boolean;
  /** Resolves on a later task, after input, rendering and timers had their turn. */
  readonly yieldTask: () => Promise<void>;
  readonly close: () => void;
};

type TaskTurns = {
  readonly mark: () => void;
  readonly turned: () => boolean;
  readonly nextTask: () => Promise<void>;
  readonly close: () => void;
};

export function createReadSlice(now: () => number = () => performance.now()): ReadSlice {
  const turns = createTaskTurns();
  let startedAt = now();
  turns.mark();
  const restart = (): void => {
    startedAt = now();
    turns.mark();
  };
  return {
    resumed: () => {
      if (turns.turned()) restart();
    },
    spent: () => now() - startedAt >= READ_LOOP_SLICE_MS,
    yieldTask: async () => {
      await turns.nextTask();
      restart();
    },
    close: turns.close,
  };
}

// Every posted message is delivered in a task of its own, so a delivery since
// `mark()` proves the event loop turned over since then.
function createTaskTurns(): TaskTurns {
  if (typeof MessageChannel !== 'function') return createTimerTaskTurns();
  const channel = new MessageChannel();
  let deliveries = 0;
  let markedAt = 0;
  let waiters: Array<() => void> = [];
  channel.port1.onmessage = () => {
    deliveries += 1;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  };
  // Node (tests) keeps a listening port alive; browsers have no unref.
  unref(channel.port1);
  unref(channel.port2);
  const post = (): void => channel.port2.postMessage(null);
  return {
    mark: () => {
      markedAt = deliveries;
      post();
    },
    turned: () => deliveries !== markedAt,
    nextTask: () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve);
        post();
      }),
    close: () => {
      channel.port1.close();
      channel.port2.close();
      const pending = waiters;
      waiters = [];
      for (const resolve of pending) resolve();
    },
  };
}

function createTimerTaskTurns(): TaskTurns {
  let deliveries = 0;
  let markedAt = 0;
  return {
    mark: () => {
      markedAt = deliveries;
      setTimeout(() => {
        deliveries += 1;
      }, 0);
    },
    turned: () => deliveries !== markedAt,
    nextTask: () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          deliveries += 1;
          resolve();
        }, 0);
      }),
    close: () => undefined,
  };
}

function unref(port: MessagePort): void {
  (port as MessagePort & { unref?: () => void }).unref?.();
}
