/**
 * T2-114: window-level error + unhandled-rejection handlers. Pre-T2-114
 * the renderer had neither — uncaught errors and rejected promises
 * vanished into the void, leaving support with no evidence of what
 * happened.
 *
 * Pairs with `AppErrorBoundary` (React tree errors). The boundary
 * catches ERRORS THAT CROSS A RENDER BOUNDARY; this file catches
 * everything else: event handlers, async work, setTimeout callbacks,
 * promise chains.
 */

export interface GlobalErrorReport {
  kind: 'error' | 'unhandledrejection';
  message: string;
  /** Best-effort stack — from `event.error` (Error case) or coerced reason. */
  stack?: string;
  /** Source URL from the ErrorEvent, when present. */
  filename?: string;
  /** 1-based line number from the ErrorEvent, when present. */
  lineno?: number;
  /** 0-based column number from the ErrorEvent, when present. */
  colno?: number;
  capturedAt: string;
}

export interface InstallOptions {
  /** Sink the handlers report to. Failures inside the sink are swallowed. */
  onReport: (report: GlobalErrorReport) => void;
  /**
   * Window-shaped target. Defaults to globalThis when unspecified;
   * tests inject a mock with addEventListener / removeEventListener.
   */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

type ErrorListener = (event: ErrorEvent) => void;
type RejectionListener = (event: PromiseRejectionEvent) => void;

/**
 * Install both handlers. Returns an `uninstall()` to detach them —
 * tests use this to clean up between cases.
 *
 * Safe to call multiple times: each installation is independent.
 * Sink errors are swallowed so a broken reporter cannot prevent the
 * page from continuing to surface other diagnostics.
 */
export function installGlobalErrorHandlers(opts: InstallOptions): () => void {
  const target = opts.target ?? (globalThis as unknown as Window);

  const onError: ErrorListener = (event) => {
    const report: GlobalErrorReport = {
      kind: 'error',
      message: event.message ?? String(event.error ?? 'Unknown error'),
      stack: extractStack(event.error),
      filename: event.filename || undefined,
      lineno: typeof event.lineno === 'number' ? event.lineno : undefined,
      colno: typeof event.colno === 'number' ? event.colno : undefined,
      capturedAt: new Date().toISOString(),
    };
    safeReport(opts.onReport, report);
  };

  const onRejection: RejectionListener = (event) => {
    const reason = event.reason;
    const report: GlobalErrorReport = {
      kind: 'unhandledrejection',
      message: reasonToMessage(reason),
      stack: extractStack(reason),
      capturedAt: new Date().toISOString(),
    };
    safeReport(opts.onReport, report);
  };

  target.addEventListener('error', onError as EventListener);
  target.addEventListener('unhandledrejection', onRejection as EventListener);

  return () => {
    target.removeEventListener('error', onError as EventListener);
    target.removeEventListener('unhandledrejection', onRejection as EventListener);
  };
}

function extractStack(value: unknown): string | undefined {
  if (value instanceof Error) return value.stack;
  return undefined;
}

function reasonToMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  if (reason == null) return 'Unhandled rejection (no reason)';
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function safeReport(
  sink: (r: GlobalErrorReport) => void,
  report: GlobalErrorReport,
): void {
  try {
    sink(report);
  } catch {
    /* swallow — broken sink should not crash the handler */
  }
}
