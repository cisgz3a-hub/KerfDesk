// useGlobalErrorHandlers — catches errors React can't reach.
//
// The ErrorBoundary handles render and commit-phase errors. Two
// classes slip past it:
//   1. Errors thrown in event handlers (React intentionally doesn't
//      boundary these; the handler returns and the app continues).
//   2. Unhandled promise rejections (any `void asyncFn()` whose
//      promise rejects).
//
// Both surface as a toast so the user knows something went wrong
// without nuking the whole UI. The toast says the design is still open and
// where to report it; the developer text sits under its details (UX audit
// U5-P3-12; the toast's own "Error:" label is not repeated). No network — the
// error message stays local.

import { useEffect } from 'react';
import { useToastStore } from '../state/toast-store';

export const UNCAUGHT_ERROR_MESSAGE =
  'Something went wrong in KerfDesk. Your design is still open. If it happens again, use Help > Save Support Report... and send the file to support.';

// One slot: a burst of the same failure rewrites it instead of stacking.
const UNCAUGHT_ERROR_KEY = 'uncaught-error';

export function useGlobalErrorHandlers(): void {
  useEffect(() => {
    const pushToast = useToastStore.getState().pushToast;
    const onError = (event: ErrorEvent): void => {
      const msg = event.error instanceof Error ? event.error.message : event.message;
      pushToast(UNCAUGHT_ERROR_MESSAGE, 'error', { key: UNCAUGHT_ERROR_KEY, details: [msg] });
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason = event.reason;
      const msg =
        reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'unknown';
      pushToast(UNCAUGHT_ERROR_MESSAGE, 'error', {
        key: UNCAUGHT_ERROR_KEY,
        details: [`Unhandled rejection: ${msg}`],
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
}
