// One-click vector commands (Offset outlines, Cut Shapes) compute in the
// vector worker (ADR-606) instead of freezing the canvas. Each click owns a
// fresh worker; a newer click of the same command terminates the older one.
// The result is committed through the ordinary action, as one undo step, only
// when the project and selection are still the ones the click saw. A real
// browser whose worker cannot start runs the command in thread, as before.

import type { VectorSceneObject } from '../../core/geometry';
import { useStore } from '../state';
import { selectedObjectIds } from '../state/scene-group-actions';
import { useToastStore } from '../state/toast-store';
import { createVectorOpSession, type VectorOpSession } from './vector-op-worker-client';
import type { VectorOpTask } from './vector-op-worker-protocol';
import type { VectorOpResultFor } from './vector-op-worker-runtime';

// Fast results land before any notice; slower ones say they are still working.
const WORKING_NOTICE_DELAY_MS = 400;

export type BackgroundVectorCommand<T extends VectorOpTask> = {
  /** Names the command in notices, and supersedes an older click of it. */
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

const running = new Map<string, VectorOpSession>();

/** Resolves true when the result was committed or handed to the in-thread fallback. */
export async function runVectorCommandInBackground<T extends VectorOpTask>(
  command: BackgroundVectorCommand<T>,
): Promise<boolean> {
  running.get(command.label)?.release();
  const session = createVectorOpSession();
  running.set(command.label, session);
  const before = snapshot();
  const noticeKey = `background-vector-${command.label}`;
  const notice = setTimeout(
    () =>
      useToastStore.getState().pushToast(`${command.label}: working…`, 'info', { key: noticeKey }),
    WORKING_NOTICE_DELAY_MS,
  );
  const outcome = await session.run(command.sources, command.task);
  clearTimeout(notice);
  if (outcome.kind === 'superseded') return false;
  session.release();
  running.delete(command.label);
  useToastStore.getState().dismissToastKey(noticeKey);
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
