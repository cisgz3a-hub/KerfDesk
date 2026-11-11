import type { StreamerState } from '../../core/controllers/grbl';
import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  type OutputScope,
  type Project,
  type ProjectVariableData,
} from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { settledCleanly } from '../state/post-job-clean-settle';
import type { RunId } from '../state/recovery';

let cancelObserver: (() => void) | null = null;

export function armVariableStreamAdvancement(
  project: Project,
  runId: RunId,
  outputScope?: OutputScope,
): {
  readonly accept: () => void;
  readonly cancel: () => void;
} {
  cancelVariableStreamAdvancement();
  const variables = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  if (variables.advancement !== 'after-successful-stream') {
    return { accept: () => undefined, cancel: () => undefined };
  }
  const initial = useLaserStore.getState();
  let previous: StreamerState | null = null;
  let priorState: LaserState | undefined;
  let epoch: number | null = null;
  let accepted = false;
  let completed = false;
  let cancelled = false;
  let unsubscribe = (): void => undefined;
  const cancel = (): void => {
    cancelled = true;
    unsubscribe();
    if (cancelObserver === cancel) cancelObserver = null;
  };
  const publish = (): void => {
    const state = useLaserStore.getState();
    if (cancelled || !accepted || !completed) return;
    if (
      state.controllerSessionEpoch !== initial.controllerSessionEpoch ||
      state.streamerEpoch !== epoch
    ) {
      cancel();
      return;
    }
    cancel();
    if (outputScope === undefined)
      useStore.getState().advanceVariablesAfter(project, 'successful-stream');
    else useStore.getState().advanceVariablesAfter(project, 'successful-stream', outputScope);
  };
  cancelObserver = cancel;
  unsubscribe = useLaserStore.subscribe((state) => {
    // The last completed run ID is deliberately retained for recovery. Ignore
    // its idle/status/start-arming updates until a new streamer is created.
    if (
      epoch === null &&
      state.streamerEpoch === initial.streamerEpoch &&
      state.controllerSessionEpoch === initial.controllerSessionEpoch
    )
      return;
    if (streamOwnerChanged(state, initial, epoch, runId)) {
      cancel();
      return;
    }
    const current = state.streamer;
    if (epoch === null) {
      if (state.activeRunId !== runId || current === null) return;
      epoch = state.streamerEpoch;
    }
    const prior = priorState;
    priorState = state;
    if (current === previous) return;
    const cleanRelease = previous !== null && settledCleanly(state, prior, previous.status);
    const outcome = variableStreamOutcome(previous, current, cleanRelease);
    previous = current;
    if (outcome === 'pending') return;
    if (outcome === 'failed') {
      cancel();
      return;
    }
    completed = true;
    publish();
  });
  return {
    accept: () => {
      accepted = true;
      publish();
    },
    cancel,
  };
}

function streamOwnerChanged(
  state: LaserState,
  initial: LaserState,
  epoch: number | null,
  runId: RunId,
): boolean {
  return (
    state.controllerSessionEpoch !== initial.controllerSessionEpoch ||
    state.streamerEpoch > (epoch ?? initial.streamerEpoch + 1) ||
    (state.activeRunId !== null && state.activeRunId !== runId)
  );
}

/**
 * A sealed laser recovery finishes the part its interrupted run started, and
 * that run consumed nothing, so a recovery that completes advances the serial
 * and CSV record once, as the run would have (oracle audit O1, O5-P1-1). It
 * advances the open project only while that project still holds the variable
 * data the run burned: after Next, a new CSV or another file, it consumes
 * nothing, as a changed Start does.
 */
export function armRecoveryVariableStreamAdvancement(
  runProject: Project,
  runId: RunId,
  outputScope?: OutputScope,
): ReturnType<typeof armVariableStreamAdvancement> {
  const open = useStore.getState().project;
  if (!sameVariableData(open.variables, runProject.variables)) {
    return { accept: () => undefined, cancel: () => undefined };
  }
  return armVariableStreamAdvancement(open, runId, outputScope);
}

function sameVariableData(
  a: Project['variables'] | undefined,
  b: Project['variables'] | undefined,
): boolean {
  const left = a ?? DEFAULT_PROJECT_VARIABLE_DATA;
  const right = b ?? DEFAULT_PROJECT_VARIABLE_DATA;
  return (
    left.recordIndex === right.recordIndex &&
    left.serialValue === right.serialValue &&
    left.advancement === right.advancement &&
    sameSequence(left.sequence, right.sequence) &&
    sameCsv(left.csv, right.csv)
  );
}

function sameSequence(
  a: ProjectVariableData['sequence'],
  b: ProjectVariableData['sequence'],
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.recordStartIndex === b.recordStartIndex &&
    a.recordEndIndex === b.recordEndIndex &&
    a.serialStartValue === b.serialStartValue &&
    a.serialEndValue === b.serialEndValue &&
    a.advanceBy === b.advanceBy
  );
}

function sameCsv(a: ProjectVariableData['csv'], b: ProjectVariableData['csv']): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.sourceName === b.sourceName &&
    sameStrings(a.headers, b.headers) &&
    a.records.length === b.records.length &&
    a.records.every((record, index) => sameStrings(record, b.records[index] ?? []))
  );
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function cancelVariableStreamAdvancement(): void {
  cancelObserver?.();
  cancelObserver = null;
}

/** `cleanRelease`: the stream was released by a settle that saw Idle, the
 *  evidence the recovery ledger records a completed run on (post-job-clean-settle). */
export function variableStreamOutcome(
  previous: StreamerState | null,
  current: StreamerState | null,
  cleanRelease: boolean,
): 'pending' | 'successful' | 'failed' {
  if (current !== null && current.status === 'errored') return 'failed';
  if (current !== null) return 'pending';
  if (previous?.status === 'done' && cleanRelease) return 'successful';
  return 'failed';
}
