// useJobReviewRebuildTrigger — while the review dialog is open, watch the
// compile-relevant store slices (project, placement, output scope) and ask
// the gate for a debounced re-prepare after any edit, whether it came from
// the dialog's own fields or anywhere else. Field commits are themselves
// debounced (F-A7), so the visible latency is commit debounce + this one.

import { useEffect, useRef } from 'react';
import { useStore } from '../../state';
import { useJobReviewStore } from './job-review-store';

const REBUILD_DEBOUNCE_MS = 250;

export function useJobReviewRebuildTrigger(): void {
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    const unsubscribe = useStore.subscribe((current, previous) => {
      if (
        current.project === previous.project &&
        current.jobPlacement === previous.jobPlacement &&
        current.outputScopeSettings === previous.outputScopeSettings
      ) {
        return;
      }
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        useJobReviewStore.getState().requestRebuild();
      }, REBUILD_DEBOUNCE_MS);
    });
    return (): void => {
      unsubscribe();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);
}
