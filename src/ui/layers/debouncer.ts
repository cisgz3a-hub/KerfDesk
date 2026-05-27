// Pure debouncer for committing a value to a store after a quiet window.
// Used by useDebouncedCommit (F-A7). Lives in its own file with no React
// imports so the scheduling semantics can be tested in isolation.
//
// Semantics:
//   * schedule(next) starts (or restarts) a timer; commit fires once the
//     timer elapses, only if `next` differs from the last committed value.
//   * flush(next) cancels the timer and commits synchronously.
//   * acknowledge(next) records that the canonical store value is now `next`
//     so a subsequent schedule(next) becomes a no-op.
//   * cancel() drops any pending commit.

export type DebouncerArgs<T> = {
  readonly initial: T;
  readonly debounceMs: number;
  readonly commit: (value: T) => void;
};

export type Debouncer<T> = {
  readonly schedule: (next: T) => void;
  readonly flush: (next: T) => void;
  readonly acknowledge: (next: T) => void;
  readonly cancel: () => void;
};

export function createDebouncer<T>(args: DebouncerArgs<T>): Debouncer<T> {
  let lastCommitted: T = args.initial;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const commitIfNew = (next: T): void => {
    if (next !== lastCommitted) {
      lastCommitted = next;
      args.commit(next);
    }
  };

  return {
    schedule: (next) => {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        commitIfNew(next);
      }, args.debounceMs);
    },
    flush: (next) => {
      cancel();
      commitIfNew(next);
    },
    acknowledge: (next) => {
      lastCommitted = next;
    },
    cancel,
  };
}
