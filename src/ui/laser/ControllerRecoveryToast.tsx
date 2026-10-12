import type { RefObject } from 'react';
import './controller-recovery-toast.css';

type Props = {
  readonly closeRef: RefObject<HTMLButtonElement>;
  readonly onDismiss: () => void;
  readonly focusOnOpen: boolean;
  readonly message: string;
  readonly readBlockReason: string | null | undefined;
  readonly reconnectRecommended: boolean;
  readonly onRetry: (() => void) | undefined;
  readonly onReconnect: (() => void) | undefined;
  readonly disabled: boolean;
};

// Keep recovery actions available without adding a row to the connection bar.
// Dismissing this UI never acknowledges safety notices or changes the session.
export function ControllerRecoveryToast(props: Props): JSX.Element {
  return (
    <section
      role="alert"
      className="lf-banner lf-banner--warning lf-controller-recovery-toast"
      aria-label="Controller information"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        props.onDismiss();
      }}
    >
      <div className="lf-controller-recovery-toast__heading">
        <strong>
          {props.reconnectRecommended
            ? 'Controller connection needs recovery'
            : 'Controller information unavailable'}
        </strong>
        <button
          type="button"
          className="lf-btn lf-controller-recovery-toast__close"
          aria-label="Dismiss controller notification"
          title="Hide this notification. Reopen it from More connection options, Controller info."
          ref={props.closeRef}
          autoFocus={props.focusOnOpen}
          onClick={props.onDismiss}
        >
          ×
        </button>
      </div>
      <p>{props.message}</p>
      {props.readBlockReason != null && (
        <p role="status">Waiting to retry: {props.readBlockReason}</p>
      )}
      <RecoveryActions {...props} />
    </section>
  );
}

function RecoveryActions(props: Props): JSX.Element {
  return (
    <div className="lf-controller-recovery-toast__actions">
      {props.onRetry !== undefined && (
        <button
          type="button"
          className="lf-btn"
          onClick={props.onRetry}
          disabled={props.disabled || props.readBlockReason !== null}
          title={
            props.readBlockReason ?? 'Read controller settings again using the current connection.'
          }
        >
          Retry reading controller settings
        </button>
      )}
      {props.reconnectRecommended && props.onReconnect !== undefined && (
        <button
          type="button"
          className="lf-btn"
          onClick={props.onReconnect}
          disabled={props.disabled}
          title="Close this controller connection and reconnect. This ends any paused job."
        >
          Reconnect controller
        </button>
      )}
    </div>
  );
}
