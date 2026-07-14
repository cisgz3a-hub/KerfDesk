// useCncPaneWidth — drives the drag-resizable width of the CNC 3D result pane
// (Cnc3DPane, ADR-191). The handle sits on the pane's LEFT edge (the border
// with the flexible canvas), so dragging left widens the pane and dragging
// right narrows it. The chosen width persists in localStorage — like the CNC
// Basic/Advanced disclosure (ADR-111) — so it survives reloads; storage access
// is guarded so non-browser test/SSR contexts stay safe.

import { useCallback, useEffect, useRef, useState } from 'react';

export const MIN_PANE_WIDTH_PX = 200;
export const MAX_PANE_WIDTH_PX = 560;
export const DEFAULT_PANE_WIDTH_PX = 260;
const KEYBOARD_STEP_PX = 16;
const STORAGE_KEY = 'laserforge.cnc-3d-pane-width.v1';

// Pure so the clamp invariant (finite, within [MIN, MAX], integral) is testable
// without a DOM. Non-finite input falls back to the default rather than NaN.
export function clampPaneWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_PANE_WIDTH_PX;
  return Math.min(MAX_PANE_WIDTH_PX, Math.max(MIN_PANE_WIDTH_PX, Math.round(px)));
}

function readStoredWidth(): number {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw === null ? DEFAULT_PANE_WIDTH_PX : clampPaneWidth(Number(raw));
  } catch {
    return DEFAULT_PANE_WIDTH_PX;
  }
}

function writeStoredWidth(px: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(px));
  } catch {
    /* storage unavailable — the in-memory width still works for the session */
  }
}

export type PaneResize = {
  readonly widthPx: number;
  readonly onHandlePointerDown: (e: React.PointerEvent) => void;
  readonly onHandleKeyDown: (e: React.KeyboardEvent) => void;
};

export function useCncPaneWidth(): PaneResize {
  const [widthPx, setWidthPx] = useState<number>(readStoredWidth);
  const dragRef = useRef<{ readonly startX: number; readonly startWidth: number } | null>(null);
  const widthRef = useRef(widthPx);
  widthRef.current = widthPx;

  // Track the drag on the window so it continues even when the pointer leaves
  // the 6px handle. Registered once; the handlers read live values via refs.
  useEffect(() => {
    function onMove(e: PointerEvent): void {
      const drag = dragRef.current;
      if (drag === null) return;
      setWidthPx(clampPaneWidth(drag.startWidth + (drag.startX - e.clientX)));
    }
    function onUp(): void {
      if (dragRef.current === null) return;
      dragRef.current = null;
      // Read the committed width through the updater rather than widthRef: a
      // trailing pointermove in the same tick may not have re-rendered yet, so
      // widthRef could still hold the pre-drag value.
      setWidthPx((committed) => {
        writeStoredWidth(committed);
        return committed;
      });
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startWidth: widthRef.current };
    e.preventDefault();
  }, []);

  const onHandleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // ArrowLeft widens (the pane grows leftward), ArrowRight narrows — matching
    // the drag direction, so the handle is usable without a pointer.
    const direction = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    if (direction === 0) return;
    e.preventDefault();
    setWidthPx((current) => {
      const next = clampPaneWidth(current + direction * KEYBOARD_STEP_PX);
      writeStoredWidth(next);
      return next;
    });
  }, []);

  return { widthPx, onHandlePointerDown, onHandleKeyDown };
}
