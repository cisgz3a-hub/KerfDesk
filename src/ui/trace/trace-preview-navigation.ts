// Direct-manipulation navigation for the trace preview viewport:
//   - wheel / Ctrl+wheel / trackpad pinch zoom about the cursor;
//   - trackpad two-finger drag and Shift+wheel scroll natively (pan);
//   - middle-drag or Space+primary-drag pans; plain primary drag stays the
//     Boundary tool, which asks `isPanGesture` before starting;
//   - touch: one finger pans, two fingers pinch-zoom and pan together;
//   - keyboard on the focused viewport: + / - step, 0 Fit, 1 actual size, and
//     the arrow keys keep scrolling natively.
// Every handler only moves the local view. None of them touches trace options,
// the Boundary or the worker, so navigation can never start a re-trace.

import { useEffect, useRef, useState } from 'react';

import {
  classifyWheel,
  pinchStep,
  wheelZoomFactor,
  type WheelLatch,
  type WheelSample,
} from './trace-preview-gestures';
import type { TracePreviewZoom } from './trace-preview-zoom';
import { MIN_PREVIEW_ZOOM, stepPreviewZoom } from './trace-preview-zoom-math';

export type TracePreviewPanState = 'idle' | 'ready' | 'panning';

type Point = { readonly x: number; readonly y: number };
type Navigation = {
  wheelLatch: WheelLatch | null;
  space: boolean;
  hovering: boolean;
  mousePan: { readonly id: number; x: number; y: number } | null;
  readonly touches: Map<number, Point>;
};

export function useTracePreviewNavigation(view: TracePreviewZoom): {
  readonly panState: TracePreviewPanState;
  readonly isPanGesture: () => boolean;
} {
  const [panState, setPanState] = useState<TracePreviewPanState>('idle');
  const viewRef = useRef(view);
  viewRef.current = view;
  const nav = useRef<Navigation>({
    wheelLatch: null,
    space: false,
    hovering: false,
    mousePan: null,
    touches: new Map(),
  });
  const { viewportRef } = view;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return undefined;
    const state = nav.current;
    const sync = (): void =>
      setPanState(state.mousePan !== null ? 'panning' : state.space ? 'ready' : 'idle');
    return attachNavigation(viewport, state, () => viewRef.current, sync);
  }, [viewportRef]);

  return {
    panState,
    isPanGesture: () => {
      const state = nav.current;
      return state.space || state.mousePan !== null || state.touches.size > 0;
    },
  };
}

function attachNavigation(
  viewport: HTMLElement,
  state: Navigation,
  view: () => TracePreviewZoom,
  sync: () => void,
): () => void {
  const pointer = pointerHandlers(viewport, state, view, sync);
  const keys = keyHandlers(viewport, state, view, sync);
  const listeners: ReadonlyArray<
    readonly [EventTarget, string, EventListener, AddEventListenerOptions?]
  > = [
    [
      viewport,
      'wheel',
      ((event: WheelEvent) => onWheel(event, state, view())) as EventListener,
      { passive: false },
    ],
    [viewport, 'pointerdown', pointer.down as EventListener],
    [viewport, 'pointermove', pointer.move as EventListener],
    [viewport, 'pointerup', pointer.end as EventListener],
    [viewport, 'pointercancel', pointer.end as EventListener],
    [viewport, 'mousedown', pointer.mouseDown as EventListener],
    [viewport, 'pointerenter', pointer.enter as EventListener],
    [viewport, 'pointerleave', pointer.leave as EventListener],
    [viewport, 'keydown', keys.zoomKey as EventListener],
    [document, 'keydown', keys.spaceDown as EventListener],
    [document, 'keyup', keys.spaceUp as EventListener],
    [window, 'blur', keys.release],
  ];
  for (const [target, type, listener, options] of listeners) {
    target.addEventListener(type, listener, options);
  }
  return () => {
    for (const [target, type, listener, options] of listeners) {
      target.removeEventListener(type, listener, options);
    }
  };
}

function onWheel(event: WheelEvent, state: Navigation, view: TracePreviewZoom): void {
  // Read deltaMode first: Firefox reports line units only to pages that ask.
  const sample: WheelSample = {
    deltaMode: event.deltaMode,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    timeStamp: event.timeStamp,
  };
  const { intent, latch } = classifyWheel(sample, state.wheelLatch);
  state.wheelLatch = latch;
  if (intent === 'pan') return; // Native, inertial scrolling pans.
  event.preventDefault(); // Also stops Ctrl+wheel from zooming the whole page.
  view.zoomBy(wheelZoomFactor(sample), event);
}

function pointerHandlers(
  viewport: HTMLElement,
  state: Navigation,
  view: () => TracePreviewZoom,
  sync: () => void,
) {
  return {
    down(event: PointerEvent): void {
      if (document.activeElement !== viewport) viewport.focus({ preventScroll: true });
      if (event.pointerType === 'touch') {
        state.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        capture(viewport, event.pointerId);
        return;
      }
      if (event.button !== 1 && !(event.button === 0 && state.space)) return;
      state.mousePan = { id: event.pointerId, x: event.clientX, y: event.clientY };
      capture(viewport, event.pointerId);
      sync();
    },
    move(event: PointerEvent): void {
      if (event.pointerType === 'touch') moveTouch(event, state, view());
      else moveMousePan(event, state, view());
    },
    end(event: PointerEvent): void {
      state.touches.delete(event.pointerId);
      if (state.mousePan?.id !== event.pointerId) return;
      state.mousePan = null;
      sync();
    },
    mouseDown(event: MouseEvent): void {
      // Middle-button autoscroll and text selection would fight the pan.
      if (event.button === 1 || state.mousePan !== null) event.preventDefault();
    },
    enter(event: PointerEvent): void {
      if (event.pointerType !== 'touch') state.hovering = true;
    },
    leave(): void {
      state.hovering = false;
    },
  };
}

function moveMousePan(event: PointerEvent, state: Navigation, view: TracePreviewZoom): void {
  const pan = state.mousePan;
  if (pan === null || pan.id !== event.pointerId) return;
  view.panBy(pan.x - event.clientX, pan.y - event.clientY);
  pan.x = event.clientX;
  pan.y = event.clientY;
}

function moveTouch(event: PointerEvent, state: Navigation, view: TracePreviewZoom): void {
  const previous = state.touches.get(event.pointerId);
  if (previous === undefined) return;
  const before = firstTwo(state.touches);
  const next = { x: event.clientX, y: event.clientY };
  state.touches.set(event.pointerId, next);
  const after = firstTwo(state.touches);
  if (before !== null && after !== null) {
    const step = pinchStep(before, after);
    // Carry the content under the old midpoint to the new one, then scale
    // about it, so the pinched feature stays under the fingers.
    view.panBy(step.pan.x, step.pan.y);
    view.zoomBy(step.factor, { clientX: step.anchor.x, clientY: step.anchor.y });
    return;
  }
  if (state.touches.size === 1) view.panBy(previous.x - next.x, previous.y - next.y);
}

function firstTwo(touches: ReadonlyMap<number, Point>): readonly [Point, Point] | null {
  const points = [...touches.values()];
  const a = points[0];
  const b = points[1];
  return a === undefined || b === undefined ? null : [a, b];
}

function capture(viewport: HTMLElement, pointerId: number): void {
  // Keep receiving moves outside the viewport. Absent in some test DOMs.
  if (typeof viewport.setPointerCapture !== 'function') return;
  try {
    viewport.setPointerCapture(pointerId);
  } catch {
    // The pointer may already be gone; the pan simply ends on its own.
  }
}

function keyHandlers(
  viewport: HTMLElement,
  state: Navigation,
  view: () => TracePreviewZoom,
  sync: () => void,
) {
  const claimsSpace = (event: KeyboardEvent): boolean =>
    event.key === ' ' &&
    !isTextEntry(event.target) &&
    (document.activeElement === viewport || state.hovering);
  return {
    zoomKey(event: KeyboardEvent): void {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = zoomKeyTarget(event.key, view());
      if (target === null) return;
      event.preventDefault();
      view().zoomTo(target);
    },
    spaceDown(event: KeyboardEvent): void {
      if (!claimsSpace(event)) return;
      event.preventDefault(); // No page scroll or button activation.
      if (state.space) return;
      state.space = true;
      sync();
    },
    spaceUp(event: KeyboardEvent): void {
      if (event.key !== ' ' || !state.space) return;
      event.preventDefault();
      state.space = false;
      sync();
    },
    release(): void {
      state.space = false;
      sync();
    },
  };
}

function zoomKeyTarget(key: string, view: TracePreviewZoom): number | null {
  switch (key) {
    case '+':
    case '=':
      return stepPreviewZoom(view.zoom, 1);
    case '-':
    case '_':
      return stepPreviewZoom(view.zoom, -1);
    case '0':
      return MIN_PREVIEW_ZOOM;
    case '1':
      return view.range.actualSize;
    default:
      return null;
  }
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'].includes(
    target.type,
  );
}
