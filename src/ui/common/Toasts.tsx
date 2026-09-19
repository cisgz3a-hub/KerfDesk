// Toasts — top-centre stack of non-blocking notifications, fixed over the
// app chrome (menu bar / toolbar). They used to sit fixed bottom-right, which
// put every green/red pop-up over the rails' Start/Job controls and the layer
// list (maintainer, 2026-09-19). Two independent guards keep them from eating
// an operator gesture: they are not over the canvas at all, and the toast body
// is `pointer-events: none` with only an explicit dismiss control interactive
// (a draft that put a click-to-dismiss toast over the drawing surface had the
// import worker's "parsing in worker" advisory swallow the mousedown starting
// a rectangle drag — e2e shape-properties caught it). Reads from useToastStore;
// auto-dismiss lives in the store. Per ADR-015 / CLAUDE.md this component is a
// thin renderer.

import { useToastStore, type ToastVariant } from '../state/toast-store';

// Three single-line toasts end ~120 px down, above the canvas at every
// window size; a fourth (the import worker's burst) would reach the rulers.
// Older toasts stay in the store and expire on their own timers; only the
// newest three are rendered.
const MAX_VISIBLE_TOASTS = 3;

export function Toasts(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts).slice(-MAX_VISIBLE_TOASTS);
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
        const dismissLabel = `Dismiss ${variantLabel.toLowerCase()} notification: ${toast.message}`;
        return (
          <div key={toast.id} style={{ ...toastStyle, ...variantStyle(toast.variant) }}>
            <span style={messageStyle}>
              <strong>{variantLabel}: </strong>
              {toast.message}
            </span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              style={dismissStyle}
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

// Fixed at the top-centre of the window, over the menu bar / toolbar chrome:
// the one surface with no drawing, no rail controls, and no numeric fields
// under a single toast. Fixed positioning takes no layout space, so a toast
// arriving or leaving never reflows the workspace.
const containerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 6,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  maxWidth: 'calc(100vw - 24px)',
  // csstype only admits numbers for zIndex, so var(--lf-z-toast) needs an
  // assertion; browsers resolve the custom property fine (toasts layer
  // above dialog backdrops, per the tokens.css z-map).
  zIndex: 'var(--lf-z-toast)' as React.CSSProperties['zIndex'],
  pointerEvents: 'none',
};
// The toast body ignores pointer input: it sits over the drawing surface, and
// a notification that appeared where the operator was about to click or start
// a drag must not swallow that gesture (a project-open "parsing in worker"
// advisory did exactly that to a rectangle drag). Only the dismiss control is
// interactive.
const toastStyle: React.CSSProperties = {
  pointerEvents: 'none',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '7px 12px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  borderLeftWidth: 3,
  borderLeftStyle: 'solid',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  boxShadow: 'var(--lf-shadow)',
  textAlign: 'left',
  maxWidth: 480,
};
const messageStyle: React.CSSProperties = { flex: '1 1 auto', minWidth: 0, padding: '2px 0' };
const dismissStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  flex: '0 0 auto',
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 16,
  lineHeight: '24px',
  cursor: 'pointer',
};
