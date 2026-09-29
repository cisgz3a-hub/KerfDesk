import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAZY_LOAD_FAILURE_ADVICE } from '../common/lazy-load-failure';
import { useToastStore } from '../state/toast-store';
import { PRELOAD_ERROR_MESSAGE, watchPreloadErrors } from './preload-error-toast';

// The event Vite's preload helper dispatches when a dynamic import fails.
function dispatchPreloadError(): Event {
  const event = new Event('vite:preloadError', { cancelable: true });
  Object.assign(event, { payload: new TypeError('Failed to fetch dynamically imported module') });
  window.dispatchEvent(event);
  return event;
}

let stopWatching: (() => void) | null = null;

function clearToasts(): void {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
}

beforeEach(clearToasts);

afterEach(() => {
  stopWatching?.();
  stopWatching = null;
  clearToasts();
});

describe('watchPreloadErrors', () => {
  it('shows one advisory toast however many chunk failures arrive', () => {
    stopWatching = watchPreloadErrors();

    dispatchPreloadError();
    dispatchPreloadError();
    dispatchPreloadError();

    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ message: PRELOAD_ERROR_MESSAGE, variant: 'warning' }),
    ]);
    // The same advice as the overlay notice.
    expect(PRELOAD_ERROR_MESSAGE).toContain(LAZY_LOAD_FAILURE_ADVICE);
  });

  it('never cancels the event, so the failed import still rejects into its boundary', () => {
    stopWatching = watchPreloadErrors();

    expect(dispatchPreloadError().defaultPrevented).toBe(false);
    expect(dispatchPreloadError().defaultPrevented).toBe(false);
  });
});
