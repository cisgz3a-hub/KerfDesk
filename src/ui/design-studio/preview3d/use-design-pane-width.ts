// use-design-pane-width — drag-resizable width for the Studio's right panel,
// the use-cnc-pane-width pattern with its own storage key. The handle sits on
// the panel's LEFT edge, so dragging left widens it. Storage access is guarded
// for non-browser test contexts.

import { useCallback, useRef, useState } from 'react';

export const MIN_DESIGN_PANE_WIDTH_PX = 240;
export const MAX_DESIGN_PANE_WIDTH_PX = 560;
export const DEFAULT_DESIGN_PANE_WIDTH_PX = 300;
const KEYBOARD_STEP_PX = 16;
const STORAGE_KEY = 'laserforge.design-side-panel-width.v1';

// Pure so the clamp invariant (finite, within bounds, integral) is testable
// without a DOM. Non-finite input falls back to the default rather than NaN.
export function clampDesignPaneWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_DESIGN_PANE_WIDTH_PX;
  return Math.min(MAX_DESIGN_PANE_WIDTH_PX, Math.max(MIN_DESIGN_PANE_WIDTH_PX, Math.round(px)));
}

function readStoredWidth(): number {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw === null ? DEFAULT_DESIGN_PANE_WIDTH_PX : clampDesignPaneWidth(Number(raw));
  } catch {
    return DEFAULT_DESIGN_PANE_WIDTH_PX;
  }
}

function writeStoredWidth(px: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(px));
  } catch {
    /* storage unavailable — the in-memory width still works for the session */
  }
}

export type DesignPaneResize = {
  readonly widthPx: number;
  readonly onHandlePointerDown: (event: React.PointerEvent) => void;
  readonly onHandleKeyDown: (event: React.KeyboardEvent) => void;
};

export function useDesignPaneWidth(): DesignPaneResize {
  const [widthPx, setWidthPx] = useState(readStoredWidth);
  const dragRef = useRef<{ readonly startX: number; readonly startWidth: number } | null>(null);

  const onHandlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      dragRef.current = { startX: event.clientX, startWidth: widthPx };
      const onMove = (move: PointerEvent) => {
        const drag = dragRef.current;
        if (drag === null) return;
        // Left-edge handle: moving the pointer left grows the panel.
        setWidthPx(clampDesignPaneWidth(drag.startWidth + (drag.startX - move.clientX)));
      };
      const onUp = () => {
        dragRef.current = null;
        setWidthPx((current) => {
          writeStoredWidth(current);
          return current;
        });
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      event.preventDefault();
    },
    [widthPx],
  );

  const onHandleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const delta =
      event.key === 'ArrowLeft'
        ? KEYBOARD_STEP_PX
        : event.key === 'ArrowRight'
          ? -KEYBOARD_STEP_PX
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    setWidthPx((current) => {
      const next = clampDesignPaneWidth(current + delta);
      writeStoredWidth(next);
      return next;
    });
  }, []);

  return { widthPx, onHandlePointerDown, onHandleKeyDown };
}
