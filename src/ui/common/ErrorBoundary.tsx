// ErrorBoundary — PROJECT.md Phase C "local-only crash reporter."
//
// Wraps the App tree. When a render or commit-phase error is thrown,
// React calls our getDerivedStateFromError and we swap in CrashScreen
// instead of the broken subtree. The crash screen shows the error
// message + stack and offers two actions:
//
//   * Copy diagnostic → builds a JSON blob (error + stack + timestamp +
//     user agent + URL) and writes it to the clipboard. Falls back to a
//     select-all textarea if the Clipboard API is unavailable (insecure
//     context / older browsers) — never a native prompt: a blocking
//     dialog here would freeze the ack pump and the Stop button if the
//     crash happened mid-job (H13, AUDIT-2026-06-10).
//   * Try again → resets boundary state and re-renders children. If
//     the underlying issue persists the boundary re-catches.
//
// No network, no analytics. Per PROJECT.md "External services: None"
// and ADR-018 license posture (proprietary). The diagnostic blob is
// for the user to paste into a bug report — never sent automatically.

import { Component, useState, type ReactNode } from 'react';

type Props = { readonly children: ReactNode };
type State =
  | { readonly kind: 'ok' }
  | { readonly kind: 'crashed'; readonly error: Error; readonly when: number };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { kind: 'ok' };

  static getDerivedStateFromError(error: Error): State {
    return { kind: 'crashed', error, when: Date.now() };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string }): void {
    // Surfacing to the dev console for debugging; production users see
    // the CrashScreen UI which gives them the same data + copy button.
    console.error('[lf2:ErrorBoundary]', error, info);
  }

  private readonly handleRetry = (): void => {
    this.setState({ kind: 'ok' });
  };

  override render(): ReactNode {
    if (this.state.kind === 'crashed') {
      return (
        <CrashScreen error={this.state.error} when={this.state.when} onRetry={this.handleRetry} />
      );
    }
    return this.props.children;
  }
}

function CrashScreen(props: {
  readonly error: Error;
  readonly when: number;
  readonly onRetry: () => void;
}): JSX.Element {
  const blob = buildDiagnostic(props.error, props.when);
  // 'manual' renders a select-all textarea instead of any native dialog. A
  // blocking window.prompt would suspend the renderer — fatal if the crash
  // happened mid-job, when the ack pump and Stop must stay alive (H13).
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');

  const handleCopy = (): void => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
      navigator.clipboard.writeText(blob).then(
        () => setCopyState('copied'),
        () => setCopyState('manual'),
      );
      return;
    }
    setCopyState('manual');
  };

  return (
    <div role="alert" style={overlayStyle}>
      <h2 style={titleStyle}>Something broke</h2>
      <p style={messageStyle}>{props.error.message || 'Unknown error'}</p>
      <pre style={stackStyle}>{props.error.stack ?? '(no stack available)'}</pre>
      <div style={actionsStyle}>
        <button type="button" onClick={handleCopy}>
          {copyState === 'copied' ? 'Copied' : 'Copy diagnostic'}
        </button>
        <button type="button" onClick={props.onRetry}>
          Try again
        </button>
      </div>
      {copyState === 'manual' && (
        <textarea
          readOnly
          value={blob}
          aria-label="Crash diagnostic — select and copy manually"
          style={fallbackStyle}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      <p style={hintStyle}>
        No data leaves your machine. The diagnostic is for your own bug report.
      </p>
    </div>
  );
}

function buildDiagnostic(err: Error, when: number): string {
  return JSON.stringify(
    {
      error: { name: err.name, message: err.message, stack: err.stack },
      when: new Date(when).toISOString(),
      agent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
      href: typeof window === 'undefined' ? 'unknown' : window.location.href,
    },
    null,
    2,
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#fff',
  color: '#222',
  padding: 24,
  overflow: 'auto',
  fontFamily: 'system-ui, sans-serif',
  zIndex: 9999,
};
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 20, color: '#c62828' };
const messageStyle: React.CSSProperties = { margin: '8px 0', fontSize: 14 };
const stackStyle: React.CSSProperties = {
  background: '#f5f5f5',
  border: '1px solid #ddd',
  borderRadius: 4,
  padding: 8,
  maxHeight: 320,
  overflow: 'auto',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
};
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 12 };
const fallbackStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 120,
  marginTop: 8,
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 12,
};
const hintStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 11,
  color: '#666',
  fontStyle: 'italic',
};
