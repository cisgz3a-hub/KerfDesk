// Toasts — a non-blocking notification stack that shares the canvas's
// available space (never the rails, which hid Start/Job and the layer list)
// or sits inside the open modal so a full-window dialog stays usable; the
// placement hook decides which. Reads from useToastStore; auto-dismiss lives
// in the store. Per ADR-015 / CLAUDE.md this component is a thin renderer.
//
// The toast body ignores pointer input and only its dismiss control is
// interactive: a click-to-dismiss toast over the drawing surface had the
// import worker's "parsing in worker" advisory swallow the mousedown that
// started a rectangle drag (e2e shape-properties caught it).

import { createPortal } from 'react-dom';
import { useToastStore, type ToastVariant } from '../state/toast-store';
import { useToastPlacement } from './use-toast-placement';
import './Toasts.css';

// Three single-line toasts fit the reserved band; a fourth (the import
// worker's burst) would push into the drawing. Older toasts stay in the store
// and expire on their own timers; only the newest three are rendered.
const MAX_VISIBLE_TOASTS = 3;

export function Toasts(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts).slice(-MAX_VISIBLE_TOASTS);
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
        const dismissLabel = `Dismiss ${variantLabel.toLowerCase()} notification: ${toast.message}`;
        return (
          <div key={toast.id} className="lf-toast" style={variantStyle(toast.variant)}>
            <span className="lf-toast__message">
              <strong>{variantLabel}: </strong>
              {toast.message}
            </span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="lf-toast__dismiss"
              aria-label={dismissLabel}
              title={dismissLabel}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
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

// Tinted surface + coloured edge instead of a solid saturated fill: the
// variant stays legible at a glance without shouting over the drawing.
function variantStyle(variant: ToastVariant): React.CSSProperties {
  switch (variant) {
    case 'success':
      return {
        background: 'var(--lf-tint-success)',
        color: 'var(--lf-success-fg)',
        borderLeftColor: 'var(--lf-success)',
      };
    case 'warning':
      return {
        background: 'var(--lf-tint-warning)',
        color: 'var(--lf-warning-fg)',
        borderLeftColor: 'var(--lf-warning)',
      };
    case 'error':
      return {
        background: 'var(--lf-tint-danger)',
        color: 'var(--lf-danger-fg)',
        borderLeftColor: 'var(--lf-danger)',
      };
    case 'info':
      return {
        background: 'var(--lf-tint-info)',
        color: 'var(--lf-accent-fg)',
        borderLeftColor: 'var(--lf-accent)',
      };
  }
}
