/**
 * T2-114: React error boundary at the app root + global window error
 * and unhandled-rejection handlers. Pre-T2-114 the codebase had no
 * `componentDidCatch`, no `window.onerror`, and no `unhandledrejection`
 * listener — a React component throw produced a white screen with no
 * log; an unhandled promise rejection was silently dropped.
 *
 * Audit 5C Critical failure 2 + Required Priority 8. T2-105 covers
 * Electron main-process crash capture; T2-114 is the renderer side.
 *
 * MVP scope:
 *   - The boundary class with `getDerivedStateFromError` +
 *     `componentDidCatch` + a CrashScreen fallback.
 *   - Reporting sink injection (`onCrash` callback) so this file
 *     compiles before T2-65 (reportError) lands.
 *   - The companion `installGlobalErrorHandlers` (separate file) wires
 *     up window error + unhandledrejection handlers.
 *
 * Out of scope: full CrashScreen UX with "Export support bundle"
 * action wired to T2-108; "last user action" tracker. Filed as
 * T2-114-followup once those tickets ship.
 */
import * as React from 'react';

export interface CrashReport {
  /** What the boundary saw — Error.message. */
  message: string;
  /** JS stack from the thrown Error, if available. */
  stack?: string;
  /** React component stack (the `at Foo` chain). */
  componentStack?: string;
  /** Wall clock at the time the boundary caught. */
  capturedAt: string;
}

export interface AppErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Called when the boundary catches a render error. The reporter
   * (reportError, T2-65) wires through this callback. Sink failures
   * are swallowed so a broken reporter does not turn into a render
   * loop on top of the original crash.
   */
  onCrash?: (report: CrashReport) => void;
  /**
   * Called when the user clicks "Try to recover". The boundary
   * resets its hasError state automatically; the wrapper can use
   * this hook to reset stores / clear caches before the re-render.
   */
  onRecover?: () => void;
  /**
   * Optional override for the fallback UI. Defaults to the built-in
   * `DefaultCrashScreen`. The override receives the same crash report
   * the sink saw.
   */
  fallback?: (
    report: CrashReport,
    onRecover: () => void,
  ) => React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  report: CrashReport | null;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, report: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      report: {
        message: error.message,
        stack: error.stack,
        capturedAt: new Date().toISOString(),
      },
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const report: CrashReport = {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      capturedAt: this.state.report?.capturedAt ?? new Date().toISOString(),
    };
    // Persist via injected sink. Try/catch keeps a broken reporter
    // from re-throwing inside the boundary — a "report failed to
    // report" loop would replace the original crash with a less
    // helpful one.
    try {
      this.props.onCrash?.(report);
    } catch {
      /* swallow — see comment above */
    }
    this.setState({ hasError: true, report });
  }

  handleRecover = (): void => {
    try {
      this.props.onRecover?.();
    } catch {
      /* swallow */
    }
    this.setState({ hasError: false, report: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError && this.state.report) {
      const fallback = this.props.fallback ?? defaultCrashScreen;
      return fallback(this.state.report, this.handleRecover);
    }
    return this.props.children;
  }
}

/**
 * Built-in fallback. Plain DOM, no design-system dependencies, so
 * the crash UI works even if the styling layer is what threw.
 */
function defaultCrashScreen(
  report: CrashReport,
  onRecover: () => void,
): React.ReactNode {
  return (
    <div
      role="alert"
      style={{
        padding: '32px',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: '720px',
        margin: '40px auto',
      }}
    >
      <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>
        LaserForge encountered an unexpected error
      </h1>
      <p style={{ marginBottom: '12px' }}>
        Your last autosave is preserved. You can try to recover, or
        restart the application.
      </p>
      <pre
        style={{
          background: '#222',
          color: '#fdd',
          padding: '12px',
          fontSize: '12px',
          overflow: 'auto',
          marginBottom: '16px',
        }}
      >
        {report.message}
        {report.stack ? `\n\n${report.stack}` : ''}
      </pre>
      <button
        type="button"
        onClick={onRecover}
        style={{ padding: '8px 16px', cursor: 'pointer' }}
      >
        Try to recover
      </button>
    </div>
  );
}
