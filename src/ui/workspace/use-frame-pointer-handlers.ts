import { useLayoutEffect, useRef, type MutableRefObject } from 'react';
import type { OwnedPointerHandlers } from './workspace-pointer-owner';

type PointerEvent = Parameters<OwnedPointerHandlers['onPointerMove']>[0];

/** Keep only the latest position between paints; never leave a queued edit after release. */
export function createPointerFrameQueue(deliver: (event: PointerEvent) => void) {
  let frame: number | null = null;
  let pending: PointerEvent | null = null;
  const cancel = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pending = null;
  };
  const flush = (): void => {
    const event = pending;
    cancel();
    if (event !== null) deliver(event);
  };
  return {
    cancel,
    flush,
    enqueue(event: PointerEvent): void {
      pending = event;
      if (frame === null) frame = requestAnimationFrame(flush);
    },
  };
}

export function useFramePointerHandlers(
  handlers: OwnedPointerHandlers,
  enabled: boolean,
  activePointerId: MutableRefObject<number | null>,
  cancelPending: MutableRefObject<() => void>,
  documentEpoch: number,
): OwnedPointerHandlers {
  const latest = useRef(handlers);
  latest.current = handlers;
  const queue = useRef<ReturnType<typeof createPointerFrameQueue> | null>(null);
  queue.current ??= createPointerFrameQueue((event) => latest.current.onPointerMove(event));
  const scheduled = queue.current;
  cancelPending.current = scheduled.cancel;
  useLayoutEffect(() => {
    if (!enabled) return scheduled.cancel;
    // Hover shortcuts must act at the latest pointer position, even between paints.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') scheduled.cancel();
      else scheduled.flush();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      scheduled.cancel();
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [scheduled, enabled]);
  // Keep keyboard-listener ordering stable when a same-sized document is opened.
  useLayoutEffect(() => scheduled.cancel, [scheduled, documentEpoch]);
  if (!enabled) return handlers;
  const owns = (event: PointerEvent): boolean => activePointerId.current === event.pointerId;
  return {
    onPointerDown: (event) => {
      if (activePointerId.current === null) scheduled.cancel();
      handlers.onPointerDown(event);
    },
    onPointerMove: (event) => {
      if (activePointerId.current === null || owns(event)) scheduled.enqueue(event);
    },
    onPointerUp: (event) => {
      if (owns(event)) scheduled.flush();
      // Flushing can update the project/selection before the finishing action.
      latest.current.onPointerUp(event);
    },
    onPointerCancel: (event) => {
      if (owns(event)) scheduled.cancel();
      handlers.onPointerCancel(event);
    },
    onLostPointerCapture: (event) => {
      if (owns(event)) scheduled.cancel();
      handlers.onLostPointerCapture(event);
    },
    onPointerLeave: (event) => {
      if (activePointerId.current === null) scheduled.cancel();
      handlers.onPointerLeave(event);
    },
  };
}
