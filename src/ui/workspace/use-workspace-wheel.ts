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

// One wheel notch zooms 1.1x, a smaller step than a zoom button click.
const WHEEL_ZOOM_STEP = 1.1;
// One notch as Chromium reports it in pixel mode and Firefox in line mode.
const PIXELS_PER_NOTCH = 100;
const LINES_PER_NOTCH = 3;
const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const MAX_STEPS_PER_EVENT = 10;
// Chromium sends a trackpad pinch as a ctrl+wheel event in pixel mode whose
// deltaY is -100 ln(scale), a few px per event. Below this size a ctrl+wheel
// is taken as a pinch, as in the trace preview (ADR-407); a Ctrl+mouse notch
// is larger and zooms one step like any notch.
const PINCH_MAX_PX = 50;
// Makes 1.1 ** steps equal the pinch's own scale, so the zoom follows the fingers.
const PINCH_GAIN = 1 / Math.log(WHEEL_ZOOM_STEP);

export type WheelZoomInput = Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>;

/**
 * Signed 1.1x zoom steps one wheel event carries, positive zooming in
 * (ADR-359 Amendment 2). A notch is 100 px, 3 lines or a page, and an event
 * zooms by the notches it carries: Chromium merges the notches that queue
 * during a slow frame into one event, and each still counts (Amendment 1).
 * A smaller delta zooms by its fraction of a notch, with no minimum, so a
 * trackpad's stream of small deltas no longer zooms a full step per event.
 * A pinch zooms by the scale the trackpad measured.
 */
export function wheelZoomSteps(event: WheelZoomInput): number {
  const pixels = wheelPixels(event);
  if (pixels === 0 || Number.isNaN(pixels)) return 0;
  const pinch =
    event.ctrlKey && event.deltaMode === DOM_DELTA_PIXEL && Math.abs(pixels) < PINCH_MAX_PX;
  const steps = (-pixels / PIXELS_PER_NOTCH) * (pinch ? PINCH_GAIN : 1);
  return Math.max(-MAX_STEPS_PER_EVENT, Math.min(MAX_STEPS_PER_EVENT, steps));
}

function wheelPixels({ deltaY, deltaMode }: WheelZoomInput): number {
  // Multiplied first so that whole notches of lines come out exact.
  if (deltaMode === DOM_DELTA_LINE) return (deltaY * PIXELS_PER_NOTCH) / LINES_PER_NOTCH;
  if (deltaMode === DOM_DELTA_PAGE) return deltaY * PIXELS_PER_NOTCH;
  return deltaY;
}

export function useWorkspaceWheelZoom(ref: React.RefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return undefined;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const steps = wheelZoomSteps(e);
      if (steps === 0) return;
      const ui = useUiStore.getState();
      ui.closeWorkspaceContextBar();
      const cursorPx = clientToCanvasPx(e, canvas);
      if (cursorPx === null) return;
      const project = useStore.getState().project;
      const next = zoomAtCursorPx({
        cursorPx,
        factor: WHEEL_ZOOM_STEP ** steps,
        canvas: { width: canvas.width, height: canvas.height },
        bed: { width: project.device.bedWidth, height: project.device.bedHeight },
        view: { zoomFactor: ui.zoomFactor, panX: ui.panX, panY: ui.panY },
      });
      ui.setView(next.zoomFactor, next.panX, next.panY);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [ref]);
}
