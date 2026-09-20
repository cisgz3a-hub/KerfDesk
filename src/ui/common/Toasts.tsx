// Toasts — a non-blocking notification stack in the workspace or modal. Reads from
// useToastStore; auto-dismiss lives in the store. Per ADR-015 / CLAUDE.md
// this component is a thin renderer; click on a toast manually dismisses it.

import { createPortal } from 'react-dom';
import { useToastStore, type ToastVariant } from '../state/toast-store';
import { useToastPlacement } from './use-toast-placement';
import './Toasts.css';

export function Toasts(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismissToast);
  const placement = useToastPlacement(toasts.length > 0);
  const notifications = (
    <div
      className={`lf-toasts${placement.host === null ? ' lf-toasts--workspace' : ''}`}
      style={placement.host === null ? placement.style : undefined}
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
    >
      {toasts.map((toast) => {
        const variantLabel = toastVariantLabel(toast.variant);
        return (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className="lf-toast"
            style={variantStyle(toast.variant)}
            aria-label={`Dismiss ${variantLabel.toLowerCase()} notification: ${toast.message}`}
            title={`Dismiss ${variantLabel.toLowerCase()} notification: ${toast.message}`}
          >
            <strong>{variantLabel}: </strong>
            {toast.message}
          </button>
        );
      })}
    </div>
  );
  return placement.host === null ? notifications : createPortal(notifications, placement.host);
}

function toastVariantLabel(variant: ToastVariant): string {
  switch (variant) {
    case 'success':
      return 'Success';
    case 'warning':
      return 'Warning';
    case 'error':
      return 'Error';
    case 'info':
      return 'Info';
  }
}

function variantStyle(variant: ToastVariant): React.CSSProperties {
  switch (variant) {
    case 'success':
      return { background: 'var(--lf-success)', color: 'var(--lf-on-fill)' };
    case 'warning':
      return { background: 'var(--lf-warning)', color: 'var(--lf-on-fill)' };
    case 'error':
      return { background: 'var(--lf-danger)', color: 'var(--lf-on-fill)' };
    case 'info':
      return { background: 'var(--lf-accent)', color: 'var(--lf-on-fill)' };
  }
}
