// ErrorBoundary — PROJECT.md Phase C "local-only crash reporter."
//
// Wraps the App tree. When a render or commit-phase error is thrown,
// React calls our getDerivedStateFromError and we swap in CrashScreen
// instead of the broken subtree. The crash screen shows the error
// message + stack and offers these actions:
//
//   * ABORT, while the machine is moving or the laser on (F60/F65), which
//     reports its own failure on the screen (rolling audit v5 J2-P2-3).
//   * Save project, while there is unsaved work (audit 27-P2-2).
//   * Copy diagnostic → builds a JSON blob (error + stack + timestamp +
//     user agent + URL) and writes it to the clipboard. Falls back to a
//     select-all textarea if the Clipboard API is unavailable (insecure
//     context / older browsers) — never a native prompt: a blocking
//     dialog here would freeze the ack pump and the Abort button if the
//     crash happened mid-job (H13, AUDIT-2026-06-10).
//   * Try again → resets boundary state and re-renders children. If
//     the underlying issue persists the boundary re-catches.
//
// No network, no analytics. Per PROJECT.md "External services: None".
// The diagnostic blob is for the user to paste into a bug report —
// never sent automatically.

import { Component, useState, type ReactNode } from 'react';
import { recordRendererProblem } from '../support/renderer-problems';
import { SOFTWARE_ABORT_LABEL, SOFTWARE_ABORT_TITLE } from './software-abort-copy';

// A generic emergency-stop hook the app root wires to the machine store. A render
// crash swaps the whole App (and its Abort button + Ctrl+. listener) for the crash
// screen, so without this a mid-job / mid-probe crash would leave NO software way
// to halt motion (F60/F65). Kept domain-agnostic so this common boundary stays
// decoupled from the laser store.
export type SoftwareAbort = {
  // Evaluated when the crash screen renders — was the machine actually moving?
  readonly isMotionLive: () => boolean;
  // Request the controller-specific reset/de-energize path. Reads live state at call time.
  // A throw or rejection is the Abort's own failure, which the crash screen shows.
  readonly trigger: () => void | Promise<void>;
};

// The project lives in a store, not in the crashed tree, so its own Save still
// works. Without this the only way back to unsaved work was Try again, which
// fails again for a lasting render bug (audit 27-P2-2).
export type CrashSave = {
  // Evaluated when the crash screen renders — is there unsaved work to save?
  readonly isNeeded: () => boolean;
  // Runs the project's own Save from the click, so a file picker still sees
  // the user's gesture.
  readonly run: () => Promise<'saved' | 'cancelled' | 'failed'>;
};

type Props = {
  readonly children: ReactNode;
  readonly softwareAbort?: SoftwareAbort;
  readonly crashSave?: CrashSave;
  // Store-driven dialogs and notices that Save and closing the app still open
  // (the large-project Save dialog, the close notice, toasts, the safety notice).
  // The subtree that normally mounts them is gone, so the crash screen hosts
  // them, above itself, behind a boundary of their own (CrashHostBoundary).
  readonly crashHosts?: ReactNode;
};
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
    // Kept for Help > Save Support Report after Try again (ADR-546).
    recordRendererProblem('crash', error);
  }

  private readonly handleRetry = (): void => {
    this.setState({ kind: 'ok' });
  };

  override render(): ReactNode {
    if (this.state.kind === 'crashed') {
      return (
        <CrashScreen
          error={this.state.error}
          when={this.state.when}
          onRetry={this.handleRetry}
          softwareAbort={this.props.softwareAbort}
          crashSave={this.props.crashSave}
          hosts={this.props.crashHosts}
        />
      );
    }
    return this.props.children;
  }
}

function CrashScreen(props: {
  readonly error: Error;
  readonly when: number;
  readonly onRetry: () => void;
  readonly softwareAbort: SoftwareAbort | undefined;
  readonly crashSave: CrashSave | undefined;
  readonly hosts: ReactNode;
}): JSX.Element {
  const blob = buildDiagnostic(props.error, props.when);
  // 'manual' renders a select-all textarea instead of any native dialog. A
  // blocking window.prompt would suspend the renderer — fatal if the crash
  // happened mid-job, when the ack pump and Abort must stay alive (H13).
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
      <CrashHostBoundary>{props.hosts}</CrashHostBoundary>
      <h2 style={titleStyle}>Something broke</h2>
      <p style={messageStyle}>{props.error.message || 'Unknown error'}</p>
      <pre style={stackStyle}>{props.error.stack ?? '(no stack available)'}</pre>
      <div style={actionsStyle}>
        <CrashAbortButton softwareAbort={props.softwareAbort} />
        <CrashSaveButton crashSave={props.crashSave} />
        <button
          type="button"
          onClick={handleCopy}
          title="Copy the local crash diagnostic so you can paste it into a bug report."
        >
          {copyState === 'copied' ? 'Copied' : 'Copy diagnostic'}
        </button>
        <button
          type="button"
          onClick={props.onRetry}
          title="Try to reload the KerfDesk interface without closing the app."
        >
          Try again
        </button>
      </div>
      {copyState === 'manual' && (
        <textarea
          readOnly
          value={blob}
          aria-label="Crash diagnostic — select and copy manually"
          title="Crash diagnostic text. Select and copy it manually if clipboard access failed."
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

// A crash-screen host that throws renders nothing instead. Past this boundary its
// error would reach the root boundary, which unmounts the job protections, or
// with none left blank the whole window (rolling audit v4 H2-P3-1, v5 J2-P2-3).
export class CrashHostBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    console.error('[lf2:CrashHostBoundary]', error);
    recordRendererProblem('crash', error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

// The ABORT's own failure stays on screen. It used to be caught and dropped, so
// a refused or failed Abort looked like nothing happened (rolling audit v5
// J2-P2-3). Never disabled: pressing it again is the retry.
function CrashAbortButton(props: {
  readonly softwareAbort: SoftwareAbort | undefined;
}): JSX.Element | null {
  const [failure, setFailure] = useState<string | null>(null);
  const softwareAbort = props.softwareAbort;
  if (softwareAbort === undefined) return null;
  // Only offer the kill control if the machine was actually moving or lit when
  // the crash hit — a soft reset when idle would needlessly void the work origin.
  const live = softwareAbort.isMotionLive();
  const fail = (error: unknown): void =>
    setFailure(error instanceof Error ? error.message : String(error));
  const abort = (): void => {
    setFailure(null);
    // Called in the click itself, so the stop is written before anything else runs.
    try {
      void Promise.resolve(softwareAbort.trigger()).catch(fail);
    } catch (error) {
      fail(error);
    }
  };
  return (
    <>
      {live && (
        <button
          type="button"
          className="lf-btn lf-btn--danger"
          style={abortStyle}
          onClick={abort}
          title={`${SOFTWARE_ABORT_TITLE} The interface crashed but the machine may still be moving or the laser on.`}
        >
          {SOFTWARE_ABORT_LABEL}
        </button>
      )}
      {failure !== null && (
        <p role="alert" style={abortFailureStyle}>
          {`${SOFTWARE_ABORT_LABEL} failed: ${failure.replace(/\.?$/, '.')} Use the physical E-stop or ` +
            'power cutoff now if the machine may still be moving or the laser on.'}
        </p>
      )}
    </>
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

function CrashSaveButton(props: { readonly crashSave: CrashSave | undefined }): JSX.Element | null {
  // Asked once: a successful Save clears the need, and the button stays to say so.
  const [needed] = useState(() => props.crashSave?.isNeeded() === true);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const crashSave = props.crashSave;
  if (!needed || crashSave === undefined) return null;
  const save = (): void => {
    setState('saving');
    crashSave.run().then(
      (result) => setState(result === 'cancelled' ? 'idle' : result),
      () => setState('failed'),
    );
  };
  return (
    <button
      type="button"
      className="lf-btn lf-btn--primary"
      onClick={save}
      disabled={state === 'saving'}
      title="Save the project to a file. Your unsaved work is still in memory although the interface crashed."
    >
      {SAVE_LABELS[state]}
    </button>
  );
}

const SAVE_LABELS = {
  idle: 'Save project',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Save failed. Try again',
} as const;

const abortStyle: React.CSSProperties = {
  fontWeight: 800,
  letterSpacing: 0.5,
  paddingInline: 16,
};
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
  padding: 24,
  overflow: 'auto',
  fontFamily: 'system-ui, sans-serif',
  zIndex: 9999,
};
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 20, color: 'var(--lf-danger-fg)' };
const messageStyle: React.CSSProperties = { margin: '8px 0', fontSize: 14 };
const stackStyle: React.CSSProperties = {
  background: 'var(--lf-bg-input)',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 8,
  maxHeight: 320,
  overflow: 'auto',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 12,
};
// Wraps under the buttons, after Try again.
const abortFailureStyle: React.CSSProperties = {
  order: 1,
  flexBasis: '100%',
  margin: 0,
  fontWeight: 600,
  color: 'var(--lf-danger-fg)',
};
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
  color: 'var(--lf-text-muted)',
  fontStyle: 'italic',
};
