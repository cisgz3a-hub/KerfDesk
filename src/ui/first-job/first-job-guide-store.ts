import { create } from 'zustand';
import type { FirstJobStepId } from './first-job-steps';

type FirstJobGuideState = {
  readonly open: boolean;
  /** Steps the operator said do not apply, for this session. */
  readonly skipped: ReadonlySet<FirstJobStepId>;
  /** Latched when a job starts while the guide is open: a finished job's
   *  display can be dismissed, but the guide stays finished. */
  readonly jobStarted: boolean;
  readonly openGuide: () => void;
  readonly closeGuide: () => void;
  readonly skip: (id: FirstJobStepId) => void;
  readonly markJobStarted: () => void;
  readonly startOver: () => void;
};

/** Session-only: the guide reads the project and controller, never writes them. */
export const useFirstJobGuideStore = create<FirstJobGuideState>((set) => ({
  open: false,
  skipped: new Set(),
  jobStarted: false,
  openGuide: () => set({ open: true }),
  closeGuide: () => set({ open: false }),
  skip: (id) => set((state) => ({ skipped: new Set([...state.skipped, id]) })),
  markJobStarted: () => set((state) => (state.jobStarted ? state : { jobStarted: true })),
  startOver: () => set({ skipped: new Set(), jobStarted: false }),
}));

export function openFirstJobGuide(): void {
  useFirstJobGuideStore.getState().openGuide();
}
