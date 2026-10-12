import { useId, useRef, useState } from 'react';
import './controller-recovery-toast.css';

type Props = {
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
  const [open, setOpen] = useState(true);
  const toastId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dismiss = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="lf-btn lf-controller-info"
        aria-label="Controller info"
        aria-expanded={open}
        aria-controls={open ? toastId : undefined}
        title="Show controller information and connection recovery actions."
        onClick={() => setOpen((shown) => !shown)}
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      {open && (
        <section
          id={toastId}
          role="alert"
          className="lf-banner lf-banner--warning lf-controller-recovery-toast"
          aria-label="Controller information"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            dismiss();
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
              title="Hide this notification. Recovery actions remain under Controller info."
              onClick={dismiss}
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
      )}
    </>
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
