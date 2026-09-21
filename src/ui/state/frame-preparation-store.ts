import { create } from 'zustand';

// Transient ownership of ordinary Frame preparation through physical completion.
// It is UI state, never a completed-Frame permit or a controller policy gate.
export const useFramePreparationStore = create<{ readonly pending: boolean }>(() => ({
  pending: false,
}));

let activeFrame: Promise<boolean> | null = null;

/** Repeated button, shortcut and setup requests join the same exact Frame. */
export function runOwnedFrame(work: () => Promise<boolean>): Promise<boolean> {
  if (activeFrame !== null) return activeFrame;
  const pending = Promise.resolve()
    .then(work)
    .finally(() => {
      activeFrame = null;
      useFramePreparationStore.setState({ pending: false });
    });
  // Reserve before publishing: a synchronous subscriber may request Frame too.
  activeFrame = pending;
  useFramePreparationStore.setState({ pending: true });
  return pending;
}
