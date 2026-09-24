import { create } from 'zustand';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';

/** Where the owned Frame is, as the operator experiences it (ADR-353). */
export type FramePreparationStage =
  /** Compiling; no motion yet. */
  | 'preparing'
  /** The compiled job's outline is being traced while the exact program is
   * still being finished off-thread. */
  | 'tracing'
  /** The trace completed; the exact program is still being finished, and no
   * Start permit exists until it arrives and matches. */
  | 'finishing';

// Transient ownership of ordinary Frame preparation through physical completion.
// It is UI state, never a completed-Frame permit or a controller policy gate.
export const useFramePreparationStore = create<{
  readonly pending: boolean;
  /** Latest compiler progress for the owned Frame, or null before its first
   * report. Reports outside an owned Frame (a permitted Start's re-preparation,
   * the Job Review re-prepare) have no control to describe and are dropped. */
  readonly progress: OutputCompilationProgress | null;
  readonly stage: FramePreparationStage;
  /** The owned preparation can be abandoned: no motion runs, and a Cancel is
   *  offered beside the status (controller audit gap-start-4). */
  readonly cancellable: boolean;
}>(() => ({
  pending: false,
  progress: null,
  stage: 'preparing',
  cancellable: false,
}));

let activeFrame: Promise<boolean> | null = null;
let activeAbort: (() => void) | null = null;
let cancelRequested = false;

/** Repeated button, shortcut and setup requests join the same exact Frame. */
export function runOwnedFrame(work: () => Promise<boolean>): Promise<boolean> {
  if (activeFrame !== null) return activeFrame;
  cancelRequested = false;
  const pending = Promise.resolve()
    .then(work)
    .finally(() => {
      activeFrame = null;
      activeAbort = null;
      useFramePreparationStore.setState({
        pending: false,
        progress: null,
        stage: 'preparing',
        cancellable: false,
      });
    });
  // Reserve before publishing: a synchronous subscriber may request Frame too.
  activeFrame = pending;
  useFramePreparationStore.setState({ pending: true, progress: null, stage: 'preparing' });
  return pending;
}

/** Offer the owned preparation's abort as Cancel until the returned release
 *  runs. A worker that never answers otherwise kept Frame and Start busy
 *  until an unrelated project or controller change (audit gap-start-4). */
export function registerFramePreparationAbort(abort: () => void): () => void {
  activeAbort = abort;
  useFramePreparationStore.setState({ cancellable: true });
  return () => {
    if (activeAbort !== abort) return;
    activeAbort = null;
    useFramePreparationStore.setState({ cancellable: false });
  };
}

/** The operator's Cancel: abandon the preparation. Motion already running is
 *  stopped with Abort, not here. */
export function cancelOwnedFramePreparation(): void {
  const abort = activeAbort;
  if (abort === null || !useFramePreparationStore.getState().cancellable) return;
  cancelRequested = true;
  abort();
}

/** True once the operator cancelled the owned preparation. */
export function framePreparationCancelled(): boolean {
  return cancelRequested;
}

/** Advance the owned Frame's stage; ignored outside an owned Frame. */
export function publishFramePreparationStage(stage: FramePreparationStage): void {
  if (!useFramePreparationStore.getState().pending) return;
  // The trace is motion: while it runs, Abort is the way to stop, not Cancel.
  useFramePreparationStore.setState({
    stage,
    cancellable: stage !== 'tracing' && activeAbort !== null,
  });
}

/** Publish compiler progress for the owned Frame that is on screen. */
export function publishFramePreparationProgress(progress: OutputCompilationProgress): void {
  if (!useFramePreparationStore.getState().pending) return;
  useFramePreparationStore.setState({ progress });
}
