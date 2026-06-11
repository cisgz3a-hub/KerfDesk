// Toasts — bottom-right stack of non-blocking notifications. Reads from
// useToastStore; auto-dismiss lives in the store. Per ADR-015 / CLAUDE.md
// this component is a thin renderer; click on a toast manually dismisses it.

import { useToastStore, type ToastVariant } from '../state/toast-store';

export function Toasts(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismissToast);
  return (
    <div style={containerStyle} aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          style={{ ...toastStyle, ...variantStyle(t.variant) }}
          aria-label={`Dismiss notification: ${t.message}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
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

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 32, // above the StatusBar
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  // csstype only admits numbers for zIndex, so var(--lf-z-toast) needs an
  // assertion; browsers resolve the custom property fine (toasts layer
  // above dialog backdrops, per the tokens.css z-map).
  zIndex: 'var(--lf-z-toast)' as React.CSSProperties['zIndex'],
  pointerEvents: 'none',
};
const toastStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  padding: '8px 14px',
  borderRadius: 4,
  border: 'none',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  boxShadow: 'var(--lf-shadow)',
  cursor: 'pointer',
  textAlign: 'left',
  maxWidth: 360,
};
