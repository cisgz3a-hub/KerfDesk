// A dialog's background vector preview (ADR-609). Each change of sources or
// task supersedes the previous run; the dialog keeps showing the last settled
// result, marked as updating, until the current request settles. A request
// that settles with a problem clears that older result, so the preview never
// shows geometry the status no longer describes.

import { useEffect, useRef, useState } from 'react';
import type { VectorSceneObject } from '../../core/geometry';
import { createVectorOpSession } from './vector-op-worker-client';
import type { VectorOpTask } from './vector-op-worker-protocol';
import type { VectorOpResultFor } from './vector-op-worker-runtime';

export type VectorOpSettled<T extends VectorOpTask> = {
  readonly sources: ReadonlyArray<VectorSceneObject>;
  readonly task: T;
  readonly result: VectorOpResultFor<T>;
};

export type VectorOpPreview<T extends VectorOpTask> = {
  /** The latest settled run, which may belong to an earlier request. */
  readonly settled: VectorOpSettled<T> | null;
  /** The settled run for exactly the current sources and task, or null while it runs. */
  readonly current: VectorOpSettled<T> | null;
  /** Set when the background preview cannot run; the in-thread action still can. */
  readonly unavailable: string | null;
  /** Set when the current request ran and failed; nothing should retry it in thread. */
  readonly failed: string | null;
};

type PreviewProblem<T extends VectorOpTask> = {
  readonly kind: 'unavailable' | 'failed';
  readonly sources: ReadonlyArray<VectorSceneObject>;
  readonly task: T;
  readonly message: string;
};

type PreviewState<T extends VectorOpTask> = {
  readonly settled: VectorOpSettled<T> | null;
  readonly problem: PreviewProblem<T> | null;
};

/** Callers pass a task memoized by value, so an unchanged request does not rerun. */
export function useVectorOpPreview<T extends VectorOpTask>(
  sources: ReadonlyArray<VectorSceneObject>,
  task: T,
): VectorOpPreview<T> {
  const [session] = useState(createVectorOpSession);
  const [state, setState] = useState<PreviewState<T>>({ settled: null, problem: null });
  useEffect(() => () => session.release(), [session]);
  useEffect(() => {
    let active = true;
    void session.run(sources, task).then((outcome) => {
      if (!active || outcome.kind === 'superseded') return;
      if (outcome.kind === 'done') {
        setState({ settled: { sources, task, result: outcome.result }, problem: null });
        return;
      }
      setState({
        settled: null,
        problem: { kind: outcome.kind, sources, task, message: outcome.message },
      });
    });
    return () => {
      active = false;
    };
  }, [session, sources, task]);
  const current =
    state.settled !== null && state.settled.sources === sources && state.settled.task === task
      ? state.settled
      : null;
  // A problem belongs to the exact request that met it, like a settled result.
  const problem =
    state.problem !== null && state.problem.sources === sources && state.problem.task === task
      ? state.problem
      : null;
  return {
    settled: state.settled,
    current,
    unavailable: problem?.kind === 'unavailable' ? problem.message : null,
    failed: problem?.kind === 'failed' ? problem.message : null,
  };
}

/** The previous array while it holds the same objects, so a re-render does not rerun the preview. */
export function useStableObjects<T>(next: ReadonlyArray<T>): ReadonlyArray<T> {
  const stable = useRef(next);
  const previous = stable.current;
  const same =
    previous === next ||
    (previous.length === next.length && previous.every((item, index) => item === next[index]));
  if (!same) stable.current = next;
  return stable.current;
}
