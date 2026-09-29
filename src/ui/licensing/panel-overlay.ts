import { useEffect } from 'react';

/** Closes an open licence or updates panel on Escape. */
export function useDismissOnEscape(open: boolean, close: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
}

// A nonmodal panel leaves the workspace usable and keyboard recovery active.
export const panelOverlay = {
  position: 'fixed',
  zIndex: 1000,
  top: 56,
  left: 16,
  maxWidth: 'min(480px, calc(100vw - 32px))',
  maxHeight: 'calc(100vh - 80px)',
  overflow: 'auto',
  border: '1px solid var(--lf-border-strong)',
  background: 'var(--lf-bg-1)',
} as const;
