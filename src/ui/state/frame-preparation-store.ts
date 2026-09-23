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
}>(() => ({
  pending: false,
  progress: null,
  stage: 'preparing',
}));

let activeFrame: Promise<boolean> | null = null;

/** Repeated button, shortcut and setup requests join the same exact Frame. */
export function runOwnedFrame(work: () => Promise<boolean>): Promise<boolean> {
  if (activeFrame !== null) return activeFrame;
  const pending = Promise.resolve()
    .then(work)
    .finally(() => {
      activeFrame = null;
      useFramePreparationStore.setState({ pending: false, progress: null, stage: 'preparing' });
    });
  // Reserve before publishing: a synchronous subscriber may request Frame too.
  activeFrame = pending;
  useFramePreparationStore.setState({ pending: true, progress: null, stage: 'preparing' });
  return pending;
}

/** Advance the owned Frame's stage; ignored outside an owned Frame. */
export function publishFramePreparationStage(stage: FramePreparationStage): void {
  if (!useFramePreparationStore.getState().pending) return;
  useFramePreparationStore.setState({ stage });
}

/** Publish compiler progress for the owned Frame that is on screen. */
export function publishFramePreparationProgress(progress: OutputCompilationProgress): void {
  if (!useFramePreparationStore.getState().pending) return;
  useFramePreparationStore.setState({ progress });
}
