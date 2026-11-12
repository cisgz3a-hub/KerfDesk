// Toasts — a non-blocking notification stack that shares the canvas's
// available space (never the rails, which hid Start/Job and the layer list)
// or sits inside the open modal so a full-window dialog stays usable; the
// placement hook decides which. Reads from useToastStore; auto-dismiss lives
// in the store. Per ADR-015 / CLAUDE.md this component is a thin renderer.
//
// The toast body ignores pointer input and only its dismiss control (and a
// folded list of notes' summary) is interactive: a click-to-dismiss toast over the drawing surface had the
// import worker's "parsing in worker" advisory swallow the mousedown that
// started a rectangle drag (e2e shape-properties caught it).
//
// ADR-708: the countdown stops while the pointer is over a toast or focus is
// inside it (use-toast-pause.ts watches the pointer without taking it). The
// region announces additions only, so a keyed toast rewritten with the same
// text says nothing again, a progress line that changes stays quiet, and a
// warning or error rewritten with new text is put in as a new node so it is
// read once.

import { createPortal } from 'react-dom';
import { Icon } from '../kit/icons';
import { VISIBLE_TOASTS, useToastStore, type Toast, type ToastVariant } from '../state/toast-store';
import { useToastPause } from './use-toast-pause';
import { useToastPlacement } from './use-toast-placement';
import { useToastScrollability } from './use-toast-scrollability';
import './Toasts.css';

export function Toasts(): JSX.Element {
  // Three single-line toasts fit the reserved band; a fourth (the import
  // worker's burst) would push into the drawing. Older toasts stay in the
  // store and expire on their own timers; warnings and errors among them stay
  // readable in the status bar's Notices list.
  const toasts = useToastStore((s) => s.toasts).slice(-VISIBLE_TOASTS);
  const dismiss = useToastStore((s) => s.dismissToast);
  const placement = useToastPlacement(toasts.length > 0);
  const layoutSignature = JSON.stringify(toasts);
  const { ref, scrollable } = useToastScrollability(layoutSignature, placement.host);
  const focus = useToastPause(ref, layoutSignature);
  const notifications = (
    <div
      ref={ref}
      className={`lf-toasts${placement.host === null ? ' lf-toasts--workspace' : ''}${scrollable ? ' lf-toasts--scrollable' : ''}`}
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
          <div
            key={toast.id}
            className="lf-toast"
            style={variantStyle(toast.variant)}
            data-toast-id={toast.id}
            onFocus={() => focus.onFocus(toast.id)}
            onBlur={(event) => focus.onBlur(toast.id, event)}
          >
            <span key={announcedKey(toast)} className="lf-toast__message">
              <strong>{variantLabel}: </strong>
              {toast.message}
              {toast.details === undefined ? null : <ToastDetails toast={toast} />}
            </span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="lf-toast__dismiss"
              aria-label={dismissLabel}
              title={dismissLabel}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
  return placement.host === null ? notifications : createPortal(notifications, placement.host);
}

// Opening the notes holds the toast until it is dismissed, so it cannot expire
// mid-read (UX audit U3-P3-6).
function ToastDetails(props: { readonly toast: Toast }): JSX.Element {
  const hold = useToastStore((s) => s.holdToast);
  const details = props.toast.details ?? [];
  return (
    <details
      className="lf-toast__details"
      onToggle={(event) => {
        if (event.currentTarget.open) hold(props.toast.id);
      }}
    >
      <summary title="Show these notes. The notice then stays until you dismiss it.">
        {details.length === 1 ? 'Show the note' : `Show all ${details.length}`}
      </summary>
      <ul>
        {details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
    </details>
  );
}

// The node a screen reader hears. A warning or error whose text changed is a
// new node, which the additions-only live region announces; the same text
// again, and every info or success rewrite, keeps its node and stays quiet
// (ADR-207, UX audit U7-P2-1: a live region must not be flooded).
function announcedKey(toast: Toast): string {
  return toast.variant === 'warning' || toast.variant === 'error'
    ? `${toast.variant}:${toast.message}`
    : 'quiet';
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
