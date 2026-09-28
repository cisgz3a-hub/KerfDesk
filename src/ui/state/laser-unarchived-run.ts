import { create } from 'zustand';
import type { ExecutionArtifactV1 } from './recovery';

/**
 * The latest laser run the execution archive could not keep: its program was
 * over the archive budget, or the archive write failed. This page still holds
 * the exact program it sent, so the run keeps an in-memory artifact and, once
 * it settles cleanly, is offered a second pass like an archived run. Another
 * run beginning, an interruption, or the page closing ends the offer (ADR-341
 * Amendment 7).
 */
type UnarchivedRunState = {
  /** The run the checkpoint tracker knows has no archive, even once released. */
  readonly runId: string | null;
  /** Builds the run's artifact; null once the run was interrupted. */
  readonly openArtifact: (() => Promise<ExecutionArtifactV1>) | null;
  /** The run settled cleanly: the counterpart of an archived receipt. */
  readonly completedRun: CompletedUnarchivedRun | null;
};

export type CompletedUnarchivedRun = {
  readonly runId: string;
  readonly openArtifact: () => Promise<ExecutionArtifactV1>;
};

const EMPTY: UnarchivedRunState = { runId: null, openArtifact: null, completedRun: null };

export const useUnarchivedRunStore = create<UnarchivedRunState>(() => EMPTY);

export function rememberUnarchivedRun(
  runId: string,
  build: () => Promise<ExecutionArtifactV1>,
): void {
  let opening: Promise<ExecutionArtifactV1> | null = null;
  const openArtifact = (): Promise<ExecutionArtifactV1> => (opening ??= build());
  useUnarchivedRunStore.setState({ runId, openArtifact, completedRun: null });
}

export function clearUnarchivedRun(): void {
  useUnarchivedRunStore.setState(EMPTY);
}

/** A run other than `runId` began: the kept run is no longer the job that
 * just finished. */
export function forgetUnarchivedRunOtherThan(runId: string): void {
  const kept = useUnarchivedRunStore.getState().runId;
  if (kept !== null && kept !== runId) clearUnarchivedRun();
}

/** The kept run was interrupted: nothing is offered for it, so its program is
 * released. The run id stays so its terminal writes are still known to have
 * no archive. */
export function releaseUnarchivedRun(runId: string): void {
  if (!isUnarchivedRun(runId)) return;
  useUnarchivedRunStore.setState({ openArtifact: null, completedRun: null });
}

export function isUnarchivedRun(runId: string): boolean {
  return useUnarchivedRunStore.getState().runId === runId;
}

/** Marks the kept run as the job that just finished; false for any other run
 * or one already released. */
export function completeUnarchivedRun(runId: string): boolean {
  const { openArtifact } = useUnarchivedRunStore.getState();
  if (!isUnarchivedRun(runId) || openArtifact === null) return false;
  useUnarchivedRunStore.setState({ completedRun: { runId, openArtifact } });
  return true;
}

export function selectCompletedUnarchivedRun(
  state: UnarchivedRunState,
): CompletedUnarchivedRun | null {
  return state.completedRun;
}

/** The artifact of the kept run `runId`, while it is kept. */
export function unarchivedRunArtifact(runId: string): Promise<ExecutionArtifactV1> | null {
  const state = useUnarchivedRunStore.getState();
  return state.runId === runId && state.openArtifact !== null ? state.openArtifact() : null;
}
