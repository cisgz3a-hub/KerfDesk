import { create } from 'zustand';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';

// Transient ownership of ordinary Frame preparation through physical completion.
// It is UI state, never a completed-Frame permit or a controller policy gate.
export const useFramePreparationStore = create<{
  readonly pending: boolean;
  /** Latest compiler progress for the owned Frame, or null before its first
   * report. Reports outside an owned Frame (a permitted Start's re-preparation,
   * the Job Review re-prepare) have no control to describe and are dropped. */
  readonly progress: OutputCompilationProgress | null;
}>(() => ({
  pending: false,
  progress: null,
}));

let activeFrame: Promise<boolean> | null = null;

/** Repeated button, shortcut and setup requests join the same exact Frame. */
export function runOwnedFrame(work: () => Promise<boolean>): Promise<boolean> {
  if (activeFrame !== null) return activeFrame;
  const pending = Promise.resolve()
    .then(work)
    .finally(() => {
      activeFrame = null;
      useFramePreparationStore.setState({ pending: false, progress: null });
    });
  // Reserve before publishing: a synchronous subscriber may request Frame too.
  activeFrame = pending;
  useFramePreparationStore.setState({ pending: true, progress: null });
  return pending;
}

/** Publish compiler progress for the owned Frame that is on screen. */
export function publishFramePreparationProgress(progress: OutputCompilationProgress): void {
  if (!useFramePreparationStore.getState().pending) return;
  useFramePreparationStore.setState({ progress });
}
