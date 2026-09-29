// One advisory toast when a lazily loaded chunk cannot be fetched, typically in
// a window still running the previous build after an Update in another window
// (see lazy-load-failure.ts). Vite's preload helper reports such a failed
// dynamic import by dispatching a cancelable `vite:preloadError` event on
// window, then rethrows the error unless a listener called preventDefault
// (https://vite.dev/guide/build#load-error-handling).
//
// This listener never calls preventDefault: the helper would then swallow the
// error and resolve the import with nothing, so the tool's LazyOverlayBoundary
// could not show what failed. It never reloads either: ADR-060 forbids
// unprompted reloads, and a reload during a job aborts the burn through the
// unload stop. One failure often raises several events (a stylesheet and a
// script, or the same tool opened twice), so the toast shows once per page.

import { APP_DISPLAY_NAME } from '../../core/app-branding';
import { LAZY_LOAD_FAILURE_ADVICE } from '../common/lazy-load-failure';
import { useToastStore } from '../state/toast-store';

export const PRELOAD_ERROR_MESSAGE = `Part of ${APP_DISPLAY_NAME} could not load. ${LAZY_LOAD_FAILURE_ADVICE}`;

/** Registered once at startup (main.tsx); returns the removal for tests. */
export function watchPreloadErrors(): () => void {
  let shown = false;
  const onPreloadError = (): void => {
    if (shown) return;
    shown = true;
    useToastStore.getState().pushToast(PRELOAD_ERROR_MESSAGE, 'warning');
  };
  window.addEventListener('vite:preloadError', onPreloadError);
  return () => window.removeEventListener('vite:preloadError', onPreloadError);
}
