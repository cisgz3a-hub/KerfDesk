// One-click vector commands (Offset outlines, Cut Shapes) compute in the
// vector worker (ADR-609) instead of freezing the canvas. They share one slot:
// a newer click of any of them, refused or not, terminates the running one, so
// at most one background result is ever committing. That also keeps two
// commits from asking for Pro admission at once, which holds one request.
// The result is committed through the ordinary action, as one undo step, only
// when the project and selection are still the ones the click saw. A real
// browser whose worker cannot start runs the command in thread, as before;
// work that ran and failed is reported, never retried on the UI thread. While
// any Pro prompt is open, a finished result is not committed: the prompt holds
// another tool's edit, which committing over it would lose.

import type { VectorSceneObject } from '../../core/geometry';
import { proPromptOpen } from '../licensing/edition';
import { useStore } from '../state';
import { selectedObjectIds } from '../state/scene-group-actions';
import { useToastStore } from '../state/toast-store';
import { createVectorOpSession, type VectorOpSession } from './vector-op-worker-client';
import type { VectorOpTask } from './vector-op-worker-protocol';
import type { VectorOpResultFor } from './vector-op-worker-runtime';

// Fast results land before any notice; slower ones say they are still working,
// refreshed so the notice outlives the toast timeout on long runs.
const WORKING_NOTICE_DELAY_MS = 400;
const WORKING_NOTICE_REFRESH_MS = 5_000;
const WORKING_NOTICE_KEY = 'background-vector-command';

export type BackgroundVectorCommand<T extends VectorOpTask> = {
  /** Names the command in notices. */
  readonly label: string;
  readonly sources: ReadonlyArray<VectorSceneObject>;
  readonly task: T;
  readonly commit: (result: VectorOpResultFor<T>) => void;
  readonly inThread: () => void;
};

type Snapshot = {
  readonly project: unknown;
  readonly selection: ReadonlyArray<string>;
};

type Running = {
  readonly label: string;
  readonly session: VectorOpSession;
  readonly stopNotice: () => void;
};

let running: Running | null = null;

/** Terminates the running one-click command, if any; `next` names what replaced it. */
export function cancelBackgroundVectorCommand(next?: string): void {
  const current = running;
  if (current === null) return;
  running = null;
  current.stopNotice();
  current.session.release();
  if (next !== undefined && next !== current.label) {
    useToastStore.getState().pushToast(`${current.label} was cancelled: ${next} started.`, 'info');
  }
}

/** Resolves true when the result was committed or handed to the in-thread fallback. */
export async function runVectorCommandInBackground<T extends VectorOpTask>(
  command: BackgroundVectorCommand<T>,
): Promise<boolean> {
  cancelBackgroundVectorCommand(command.label);
  const session = createVectorOpSession();
  const owner: Running = {
    label: command.label,
    session,
    stopNotice: workingNotice(command.label),
  };
  running = owner;
  const before = snapshot();
  const outcome = await session.run(command.sources, command.task);
  if (outcome.kind === 'superseded' || running !== owner) return false;
  cancelBackgroundVectorCommand();
  if (outcome.kind === 'failed') {
    useToastStore
      .getState()
      .pushToast(`${command.label} could not be completed. ${outcome.message}`, 'error');
    return false;
  }
  if (proPromptOpen()) {
    useToastStore
      .getState()
      .pushToast(
        `${command.label} was not applied: a Pro prompt is open. Close it, then run ${command.label} again.`,
        'info',
      );
    return false;
  }
  if (!unchanged(before)) {
    useToastStore
      .getState()
      .pushToast(
        `${command.label} was not applied: the project or selection changed while it was worked out.`,
        'info',
      );
    return false;
  }
  if (outcome.kind === 'unavailable') command.inThread();
  else command.commit(outcome.result);
  return true;
}

function workingNotice(label: string): () => void {
  const show = (): void =>
    useToastStore.getState().pushToast(`${label}: working…`, 'info', { key: WORKING_NOTICE_KEY });
  let refresh: ReturnType<typeof setInterval> | undefined;
  const start = setTimeout(() => {
    show();
    refresh = setInterval(show, WORKING_NOTICE_REFRESH_MS);
  }, WORKING_NOTICE_DELAY_MS);
  return () => {
    clearTimeout(start);
    clearInterval(refresh);
    useToastStore.getState().dismissToastKey(WORKING_NOTICE_KEY);
  };
}

function snapshot(): Snapshot {
  const state = useStore.getState();
  return { project: state.project, selection: selectedObjectIds(state) };
}

function unchanged(before: Snapshot): boolean {
  const now = snapshot();
  return (
    now.project === before.project &&
    now.selection.length === before.selection.length &&
    now.selection.every((id, index) => id === before.selection[index])
  );
}
