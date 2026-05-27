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
// without nuking the whole UI. No network — the error message stays
// local.

import { useEffect } from 'react';
import { useToastStore } from '../state/toast-store';

export function useGlobalErrorHandlers(): void {
  useEffect(() => {
    const pushToast = useToastStore.getState().pushToast;
    const onError = (event: ErrorEvent): void => {
      const msg = event.error instanceof Error ? event.error.message : event.message;
      pushToast(`Error: ${msg}`, 'error');
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason = event.reason;
      const msg =
        reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'unknown';
      pushToast(`Unhandled rejection: ${msg}`, 'error');
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
}
