// When the toolbar's Update button must not start an install (ADR-561
// Amendment 7): machine work an update prompt waits for, plus a pending Frame
// and an open Job Review, which the update close refuses too
// (desktop-close-runtime's updateCloseBlocked). This only decides what the
// button offers; the guarded update close rechecks everything when it runs.

import { useJobReviewStore } from '../laser/job-review/job-review-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { useLaserStore } from '../state/laser-store';
import { machineWorkActive } from './machine-work-active';

export function useUpdateInstallWaits(): boolean {
  const machineBusy = useLaserStore(machineWorkActive);
  const framePending = useFramePreparationStore((state) => state.pending);
  const reviewOpen = useJobReviewStore((state) => state.state.kind === 'open');
  return machineBusy || framePending || reviewOpen;
}

/** Read at click time, so work that started after the last render still wins. */
export function updateInstallWaitsNow(): boolean {
  return (
    machineWorkActive(useLaserStore.getState()) ||
    useFramePreparationStore.getState().pending ||
    useJobReviewStore.getState().state.kind === 'open'
  );
}
