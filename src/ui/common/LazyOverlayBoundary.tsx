// Error boundary around a lazily loaded overlay (visual tutorials, Image Studio,
// Design Studio). When the overlay's code could not be fetched (see
// lazy-load-failure.ts), it shows a short notice in place of the overlay and
// the rest of the app keeps running. Without it the root boundary swapped the
// whole workspace for the crash screen, and that screen's Try again re-threw the
// same cached rejection. Close shuts the overlay through its own store action
// and resets the boundary. Nothing here reloads the page (ADR-060).
//
// Anything else thrown inside the overlay is a bug, not a missing file, so it is
// rethrown to the root boundary and its crash screen, exactly as before.

import { Component, useId, useRef, type ReactNode } from 'react';
import { isLazyLoadError, LAZY_LOAD_FAILURE_ADVICE } from './lazy-load-failure';
import { useDialogA11y } from './use-dialog-a11y';
import { useRegisterModal } from './use-register-modal';

type Props = {
  readonly children: ReactNode;
  /** Starts the notice's heading: "<toolName> could not load". */
  readonly toolName: string;
  /** Closes the overlay through its own store action. */
  readonly onClose: () => void;
  /**
   * 'dialog' (the default) stands in for a full-window overlay. 'inline' sits
   * inside a dialog frame the host keeps on screen, as the tutorials do.
   */
  readonly presentation?: 'dialog' | 'inline';
};

// Wrapped so a thrown `undefined` still counts as a failure.
type State = { readonly failure: { readonly error: unknown } | null };

type NoticeProps = { readonly toolName: string; readonly onClose: () => void };

export class LazyOverlayBoundary extends Component<Props, State> {
  override state: State = { failure: null };

  static getDerivedStateFromError(error: unknown): State {
    return { failure: { error } };
  }

  private readonly handleClose = (): void => {
    this.props.onClose();
    this.setState({ failure: null });
  };

  override render(): ReactNode {
    const { failure } = this.state;
    if (failure === null) return this.props.children;
    // A boundary cannot catch its own render error, so this reaches the root
    // ErrorBoundary: its crash screen and diagnostic stay the home for bugs.
    if (!isLazyLoadError(failure.error)) throw failure.error;
    const Notice = this.props.presentation === 'inline' ? InlineNotice : DialogNotice;
    return <Notice toolName={this.props.toolName} onClose={this.handleClose} />;
  }
}

function InlineNotice(props: NoticeProps): JSX.Element {
  // The host's dialog already traps focus and closes on Escape; role="alert"
  // announces the change that replaced the loading line.
  return (
    <div role="alert" style={inlineStyle}>
      <NoticeBody {...props} />
    </div>
  );
}

function DialogNotice(props: NoticeProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const adviceId = useId();
  // The overlay it replaces was modal, so the notice is too: app shortcuts
  // yield, Escape closes, and focus returns to what opened the tool.
  useRegisterModal();
  useDialogA11y(ref, props.onClose);
  return (
    <div style={backdropStyle}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={adviceId}
        tabIndex={-1}
        style={cardStyle}
      >
        <NoticeBody {...props} headingId={headingId} adviceId={adviceId} />
      </div>
    </div>
  );
}

function NoticeBody(
  props: NoticeProps & { readonly headingId?: string; readonly adviceId?: string },
): JSX.Element {
  return (
    <>
      <h2 id={props.headingId} style={headingStyle}>
        {props.toolName} could not load
      </h2>
      <p id={props.adviceId} style={adviceStyle}>
        {LAZY_LOAD_FAILURE_ADVICE}
      </p>
      <button
        type="button"
        className="lf-btn"
        title="Close this tool and return to your work"
        onClick={props.onClose}
      >
        Close
      </button>
    </>
  );
}

// Same layer and backdrop as the overlays' own loading cards (z 1010: above
// dialogs, below toasts), so the notice appears exactly where the tool would.
const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1010,
  display: 'grid',
  placeItems: 'center',
  background: 'color-mix(in srgb, var(--lf-bg-0) 70%, transparent)',
};

const cardStyle: React.CSSProperties = {
  maxWidth: 420,
  margin: 16,
  padding: '16px 20px',
  borderRadius: 8,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
};

const inlineStyle: React.CSSProperties = { padding: 32, maxWidth: 520 };
const headingStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: 16 };
const adviceStyle: React.CSSProperties = { margin: '0 0 14px', fontSize: 13, lineHeight: 1.45 };
