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
      return { background: '#2e7d32', color: '#fff' };
    case 'warning':
      return { background: '#ed6c02', color: '#fff' };
    case 'error':
      return { background: '#c62828', color: '#fff' };
    case 'info':
      return { background: '#1976d2', color: '#fff' };
  }
}

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 32, // above the StatusBar
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  zIndex: 1000,
  pointerEvents: 'none',
};
const toastStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  padding: '8px 14px',
  borderRadius: 4,
  border: 'none',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  cursor: 'pointer',
  textAlign: 'left',
  maxWidth: 360,
};
