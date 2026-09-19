// Toasts — top-centre stack of non-blocking notifications, overlaid on the
// canvas under the view switch. They used to sit fixed bottom-right, which
// put every green/red pop-up over the rails' Start/Job controls and the layer
// list (maintainer, 2026-09-19). Reads from useToastStore; auto-dismiss lives
// in the store. Per ADR-015 / CLAUDE.md this component is a thin renderer;
// click on a toast manually dismisses it.

import { useToastStore, type ToastVariant } from '../state/toast-store';

export function Toasts(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismissToast);
  return (
    <div
      style={containerStyle}
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
            style={{ ...toastStyle, ...variantStyle(toast.variant) }}
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

// Absolute inside the canvas area (App.tsx CanvasArea): top-centre keeps the
// rulers (left), the motion badge (top-right), the zoom controls
// (bottom-right) and the Live Motion bar (bottom) clear, and covers only
// drawing surface under the view switch.
const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 52, // under the canvas view switch (top 10 + its height)
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  maxWidth: 'calc(100% - 24px)',
  // csstype only admits numbers for zIndex, so var(--lf-z-toast) needs an
  // assertion; browsers resolve the custom property fine (toasts layer
  // above dialog backdrops, per the tokens.css z-map).
  zIndex: 'var(--lf-z-toast)' as React.CSSProperties['zIndex'],
  pointerEvents: 'none',
};
const toastStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  padding: '7px 12px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  borderLeftWidth: 3,
  borderLeftStyle: 'solid',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  boxShadow: 'var(--lf-shadow)',
  cursor: 'pointer',
  textAlign: 'left',
  maxWidth: 420,
};
