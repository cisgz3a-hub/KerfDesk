import { useEffect } from 'react';
import { createStore } from 'zustand/vanilla';
import type { CanvasMotionPlan, LiveCanvasRun } from '../state/canvas-motion-plan';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useStore } from '../state/store';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';

const lifecycle = createStore<{ readonly installed: boolean }>(() => ({ installed: false }));
// Status reports replace a run snapshot, but its stream epoch and start stamp
// stay owned by the execution. A weak plan key keeps the context session-only.
const documentsByPlan = new WeakMap<CanvasMotionPlan, Map<string, string>>();

function isActiveRun(run: LiveCanvasRun): boolean {
  return ['running', 'paused', 'tool-change'].includes(run.lifecycle);
}

function documentOf(run: LiveCanvasRun, streamerEpoch: number): string {
  const stamp = `${streamerEpoch}:${run.startedAtMs}`;
  const existing = documentsByPlan.get(run.plan);
  const captured = existing?.get(stamp);
  if (captured !== undefined) return captured;
  const signature = currentReplayExecutionSignature();
  const byStart = existing ?? new Map<string, string>();
  byStart.set(stamp, signature);
  documentsByPlan.set(run.plan, byStart);
  return signature;
}

function expireChangedTerminalDisplay(): void {
  const laser = useLaserStore.getState();
  const run = laser.liveCanvasRun ?? null;
  if (run === null) return;
  // Capture while active, before an Open or edit can replace its document.
  // Painted/recovered runs can have a different program key from that document.
  const document = documentOf(run, laser.streamerEpoch);
  // Interrupted displays retain their established recovery presentation.
  if (run.lifecycle !== 'finished' || isActiveJob(laser.streamer)) return;
  if (currentReplayExecutionSignature() === document) return;
  // Let recovery observers receive the original clean settlement transition
  // before this display-only mutation creates another store notification.
  queueMicrotask(() => {
    const state = useLaserStore.getState();
    const current = state.liveCanvasRun;
    if (
      current?.plan !== run.plan ||
      state.streamerEpoch !== laser.streamerEpoch ||
      current.startedAtMs !== run.startedAtMs ||
      current.lifecycle !== 'finished' ||
      isActiveJob(state.streamer)
    )
      return;
    useLaserStore.setState({ liveCanvasRun: null });
  });
}

/** Terminal output belongs to the job that produced it, independently of
 * whether a visible canvas can compile replacement idle markers. This only
 * retires display state; machine state, Frame and recovery remain untouched. */
export function ensureTerminalCanvasRunInvalidationSubscriptions(): void {
  if (lifecycle.getState().installed) return;
  lifecycle.setState({ installed: true });
  useStore.subscribe((state, previous) => {
    if (
      state.project === previous.project &&
      state.outputScopeSettings === previous.outputScopeSettings &&
      state.jobPlacement === previous.jobPlacement &&
      state.selectedObjectId === previous.selectedObjectId &&
      state.additionalSelectedIds === previous.additionalSelectedIds
    )
      return;
    expireChangedTerminalDisplay();
  });
  useExperimentalLaserFeatures.subscribe(expireChangedTerminalDisplay);
  usePrintCutSessionStore.subscribe(expireChangedTerminalDisplay);
  useLaserStore.subscribe((state, previous) => {
    const run = state.liveCanvasRun ?? null;
    const previousRun = previous.liveCanvasRun ?? null;
    if (run === null) return;
    if (
      previousRun !== null &&
      run.plan === previousRun.plan &&
      state.streamerEpoch === previous.streamerEpoch &&
      run.startedAtMs === previousRun.startedAtMs &&
      run.lifecycle === previousRun.lifecycle &&
      (isActiveRun(run) || isActiveJob(state.streamer) === isActiveJob(previous.streamer))
    )
      return;
    expireChangedTerminalDisplay();
  });
  expireChangedTerminalDisplay();
}

/** The job dock stays mounted while G-code unmounts the 2D workspace. */
export function useTerminalCanvasRunInvalidation(): void {
  useEffect(ensureTerminalCanvasRunInvalidationSubscriptions, []);
}
