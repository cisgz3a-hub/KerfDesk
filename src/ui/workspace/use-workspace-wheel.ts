// Wheel-to-zoom for the canvas, installed as a NON-PASSIVE native listener.
//
// React registers its synthetic `onWheel` as a passive listener (React 17+),
// so calling `preventDefault()` inside it is a no-op — Ctrl+wheel and trackpad
// pinch fall through to the browser's own page zoom on top of our canvas zoom
// (audit C7). Attaching directly to the canvas element with `{ passive: false }`
// is the only way to suppress that. The handler reads project + view fresh from
// the stores at event time, so the effect subscribes once (stable ref dep) and
// never needs to re-attach as the scene or viewport changes.

import { useEffect } from 'react';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { clientToCanvasPx, zoomAtCursorPx } from './view-transform';

// Matches the 1.25× keyboard/Ctrl-wheel notch feel used elsewhere is 1.1 per
// wheel tick here — one physical notch is a smaller step than a button click.
const WHEEL_ZOOM_IN_FACTOR = 1.1;
// One notch as Chromium reports it in pixel mode and Firefox in line mode.
const PIXELS_PER_NOTCH = 100;
const LINES_PER_NOTCH = 3;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const MAX_STEPS_PER_EVENT = 10;

/**
 * Zoom steps one wheel event carries. Chromium merges the wheel events that
 * queue while a frame paints into one event with their summed delta, so one
 * event can hold several notches. Counting only its sign dropped them: ten
 * notches spun over a canvas busy with a large picture zoomed six steps, so
 * the zoom speed depended on paint time. A delta smaller than a notch (a
 * trackpad, a high-resolution wheel) still zooms one step, as before.
 */
export function wheelZoomSteps(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
  const perNotch =
    event.deltaMode === DOM_DELTA_LINE
      ? LINES_PER_NOTCH
      : event.deltaMode === DOM_DELTA_PAGE
        ? 1
        : PIXELS_PER_NOTCH;
  const notches = Math.round(Math.abs(event.deltaY) / perNotch);
  if (!Number.isFinite(notches)) return 1;
  return Math.min(MAX_STEPS_PER_EVENT, Math.max(1, notches));
}

export function useWorkspaceWheelZoom(ref: React.RefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return undefined;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (e.deltaY === 0) return;
      const ui = useUiStore.getState();
      ui.closeWorkspaceContextBar();
      const cursorPx = clientToCanvasPx(e, canvas);
      if (cursorPx === null) return;
      const project = useStore.getState().project;
      const notch = e.deltaY < 0 ? WHEEL_ZOOM_IN_FACTOR : 1 / WHEEL_ZOOM_IN_FACTOR;
      const factor = notch ** wheelZoomSteps(e);
      const next = zoomAtCursorPx({
        cursorPx,
        factor,
        canvas: { width: canvas.width, height: canvas.height },
        bed: { width: project.device.bedWidth, height: project.device.bedHeight },
        view: { zoomFactor: ui.zoomFactor, panX: ui.panX, panY: ui.panY },
      });
      ui.setZoom(next.zoomFactor);
      ui.setPan(next.panX, next.panY);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [ref]);
}
