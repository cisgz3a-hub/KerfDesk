// useJobReviewRebuildTrigger — while the review dialog is open, watch the
// compile-relevant store slices (project, placement, output scope) and ask
// the gate for a debounced re-prepare after any edit, whether it came from
// the dialog's own fields or anywhere else. Field commits are themselves
// debounced (F-A7), so the visible latency is commit debounce + this one.

import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../../state';
import { useJobReviewStore } from './job-review-store';

const REBUILD_DEBOUNCE_MS = 250;

/**
 * Debounces compile-relevant store changes and returns an immediate rebuild callback.
 * The callback cancels any pending debounce so explicit approval produces exactly one signal.
 */
export function useJobReviewRebuildTrigger(): () => void {
  const timerRef = useRef<number | null>(null);
  const requestRebuildNow = useCallback((): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    useJobReviewStore.getState().requestRebuild();
  }, []);
  useEffect(() => {
    const unsubscribe = useStore.subscribe((current, previous) => {
      if (
        current.project === previous.project &&
        current.jobPlacement === previous.jobPlacement &&
        current.outputScopeSettings === previous.outputScopeSettings &&
        current.selectedObjectId === previous.selectedObjectId &&
        current.additionalSelectedIds === previous.additionalSelectedIds
      ) {
        return;
      }
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        requestRebuildNow();
      }, REBUILD_DEBOUNCE_MS);
    });
    return (): void => {
      unsubscribe();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [requestRebuildNow]);
  return requestRebuildNow;
}
