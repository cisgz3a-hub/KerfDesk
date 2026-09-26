// A background preview job that keeps up with an input that keeps moving
// (ADR-425). Playback moves the scrubber faster than a slow machine prepares
// a cut, so cancelling the running job on every step meant none ever
// finished. Here a newer input waits instead: the running job finishes and
// settles, then only the newest waiting input runs. cancel() is for inputs
// that make the running job useless, such as a new toolpath or the preview
// closing.

export type CoalescedOutcome<Result> =
  | { readonly kind: 'done'; readonly value: Result }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed'; readonly error: unknown };

export type CoalescedJob<Input> = {
  /** Run now when idle; otherwise run after the running job settles. */
  readonly request: (input: Input) => void;
  /** Abort the running job, drop the waiting input and ignore late results. */
  readonly cancel: () => void;
};

type Running<Input> = { readonly input: Input; readonly controller: AbortController };

export function createCoalescedJob<Input, Result>(
  run: (input: Input, signal: AbortSignal) => Promise<Result> | null,
  settle: (input: Input, outcome: CoalescedOutcome<Result>) => void,
  isSuperseded: (error: unknown) => boolean,
): CoalescedJob<Input> {
  let running: Running<Input> | null = null;
  let waiting: { readonly input: Input } | null = null;

  const finish = (current: Running<Input>, outcome: CoalescedOutcome<Result> | null): void => {
    if (running !== current) return;
    running = null;
    // Superseded means newer work took the lane; that work settles instead.
    if (outcome !== null) settle(current.input, outcome);
    const next = waiting;
    waiting = null;
    if (next !== null) start(next.input);
  };
  const start = (input: Input): void => {
    const current: Running<Input> = { input, controller: new AbortController() };
    running = current;
    const pending = run(input, current.controller.signal);
    if (pending === null) {
      finish(current, { kind: 'unavailable' });
      return;
    }
    void pending.then(
      (value) => finish(current, { kind: 'done', value }),
      (error: unknown) => finish(current, isSuperseded(error) ? null : { kind: 'failed', error }),
    );
  };

  return {
    request: (input) => {
      if (running === null) start(input);
      else waiting = Object.is(running.input, input) ? null : { input };
    },
    cancel: () => {
      const current = running;
      running = null;
      waiting = null;
      current?.controller.abort();
    },
  };
}
