// Stops a toast's countdown while the operator points at it or has keyboard
// focus inside it (annoyance audit A5-P2-5, ADR-708).
//
// The toast body takes no pointer input, so a click or drag through it
// reaches the canvas (see Toasts.tsx), and the browser therefore never sends
// it a hover event. The pointer is watched on the document instead and
// compared with each toast's box: nothing here becomes a pointer target.

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useToastStore } from '../state/toast-store';

type Point = { readonly x: number; readonly y: number };

export type ToastFocusHandlers = {
  readonly onFocus: (id: string) => void;
  readonly onBlur: (id: string, event: React.FocusEvent<HTMLElement>) => void;
};

export function useToastPause(
  region: RefObject<HTMLElement | null>,
  /** Changes whenever the stack's layout may have: the toasts as rendered. */
  layoutSignature: string,
): ToastFocusHandlers {
  const hovered = useRef<string | null>(null);
  const focused = useRef<string | null>(null);
  const pointer = useRef<Point | null>(null);

  const apply = useCallback((nextHovered: string | null, nextFocused: string | null): void => {
    const before = new Set([hovered.current, focused.current]);
    const after = new Set([nextHovered, nextFocused]);
    hovered.current = nextHovered;
    focused.current = nextFocused;
    const { pauseToast, resumeToast } = useToastStore.getState();
    for (const id of before) if (id !== null && !after.has(id)) resumeToast(id);
    for (const id of after) if (id !== null && !before.has(id)) pauseToast(id);
  }, []);

  const hitTest = useCallback((): void => {
    apply(toastUnder(region.current, pointer.current), focused.current);
  }, [apply, region]);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      // A pressed button is a drag across the canvas, not someone reading.
      pointer.current = event.buttons === 0 ? { x: event.clientX, y: event.clientY } : null;
      hitTest();
    };
    const onLeave = (): void => {
      pointer.current = null;
      hitTest();
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    // The pointer left the window: nothing is being pointed at.
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    return (): void => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      apply(null, null);
    };
  }, [apply, hitTest]);

  // A toast that arrives or leaves moves the others under a still pointer.
  useLayoutEffect(() => {
    hitTest();
  }, [hitTest, layoutSignature]);

  return {
    onFocus: (id) => apply(hovered.current, id),
    onBlur: (id, event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      if (focused.current === id) apply(hovered.current, null);
    },
  };
}

function toastUnder(region: HTMLElement | null, point: Point | null): string | null {
  if (region === null || point === null) return null;
  for (const toast of region.querySelectorAll<HTMLElement>('[data-toast-id]')) {
    const box = toast.getBoundingClientRect();
    if (
      box.width > 0 &&
      box.height > 0 &&
      point.x >= box.left &&
      point.x <= box.right &&
      point.y >= box.top &&
      point.y <= box.bottom
    ) {
      return toast.dataset.toastId ?? null;
    }
  }
  return null;
}
