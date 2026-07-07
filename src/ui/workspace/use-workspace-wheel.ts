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

export function useWorkspaceWheelZoom(ref: React.RefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return undefined;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const ui = useUiStore.getState();
      ui.closeWorkspaceContextBar();
      const cursorPx = clientToCanvasPx(e, canvas);
      if (cursorPx === null) return;
      const project = useStore.getState().project;
      const factor = e.deltaY < 0 ? WHEEL_ZOOM_IN_FACTOR : 1 / WHEEL_ZOOM_IN_FACTOR;
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
