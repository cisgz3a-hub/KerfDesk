// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import { viewer3dDragAction } from '../viewer3d/viewer3d-controls';
import { createCut3DGlide } from './cut3d-offscreen-glide';
import type { Cut3DOffscreenControl } from './cut3d-offscreen-worker-protocol';
import type { Viewer3DZoomCursor } from './viewer3d-keyboard-controls';
import { installViewer3DKeyboardInput } from './viewer3d-keyboard-input';

export type Cut3DViewportSize = {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pixelRatio: number;
};

export type Cut3DOffscreenInput = {
  readonly start: () => void;
  readonly sendCurrentSize: () => void;
  readonly dispose: () => void;
};

type DragKind = 'pan' | 'rotate';

const MIN_VIEWPORT_PX = 1;

/** Proxies only compact pointer, wheel, and viewport values into the worker. */
export function createCut3DOffscreenInput(
  canvas: HTMLCanvasElement,
  onControl: (control: Cut3DOffscreenControl) => void,
  onResize: (size: Cut3DViewportSize) => void,
): Cut3DOffscreenInput {
  let observer: ResizeObserver | null = null;
  let disposeKeyboard: (() => void) | null = null;
  let isStarted = false;
  const drag = createPointerDrag(canvas, onControl);
  // A wheel step or a key ends the glide of the last drag.
  const sendControl = (control: Cut3DOffscreenControl): void => {
    drag.stopGlide();
    onControl(control);
  };
  const handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    sendControl({ kind: 'zoom', deltaY: event.deltaY, cursor: cursorNdc(canvas, event) });
  };
  const preventContextMenu = (event: Event): void => event.preventDefault();
  const sendCurrentSize = (): void => onResize(measureViewport(canvas));

  return {
    start: () => {
      if (isStarted) return;
      isStarted = true;
      canvas.addEventListener('pointerdown', drag.down);
      canvas.addEventListener('pointermove', drag.move);
      canvas.addEventListener('pointerup', drag.end);
      canvas.addEventListener('pointercancel', drag.end);
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      disposeKeyboard = installViewer3DKeyboardInput(canvas, sendControl);
      canvas.addEventListener('contextmenu', preventContextMenu);
      window.addEventListener('resize', sendCurrentSize);
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(sendCurrentSize);
        observer.observe(canvas);
      }
      sendCurrentSize();
    },
    sendCurrentSize,
    dispose: () => {
      if (!isStarted) return;
      isStarted = false;
      drag.stopGlide();
      observer?.disconnect();
      observer = null;
      window.removeEventListener('resize', sendCurrentSize);
      canvas.removeEventListener('pointerdown', drag.down);
      canvas.removeEventListener('pointermove', drag.move);
      canvas.removeEventListener('pointerup', drag.end);
      canvas.removeEventListener('pointercancel', drag.end);
      canvas.removeEventListener('wheel', handleWheel);
      disposeKeyboard?.();
      disposeKeyboard = null;
      canvas.removeEventListener('contextmenu', preventContextMenu);
    },
  };
}

type PointerDrag = {
  readonly down: (event: PointerEvent) => void;
  readonly move: (event: PointerEvent) => void;
  readonly end: (event: PointerEvent) => void;
  readonly stopGlide: () => void;
};

// One pointer drags at a time. Letting go glides on briefly, like every other
// 3D view (ADR-426); a cancelled pointer stops dead.
function createPointerDrag(
  canvas: HTMLCanvasElement,
  onControl: (control: Cut3DOffscreenControl) => void,
): PointerDrag {
  let activePointerId: number | null = null;
  let dragKind: DragKind | null = null;
  let lastX = 0;
  let lastY = 0;
  const glide = createCut3DGlide((kind, deltaX, deltaY) =>
    onControl(controlForDrag(kind, deltaX, deltaY)),
  );
  return {
    down: (event) => {
      const nextKind = dragKindForButton(event.button);
      if (nextKind === null) return;
      event.preventDefault();
      activePointerId = event.pointerId;
      dragKind = nextKind;
      lastX = event.clientX;
      lastY = event.clientY;
      glide.begin();
      canvas.setPointerCapture?.(event.pointerId);
    },
    move: (event) => {
      if (event.pointerId !== activePointerId || dragKind === null) return;
      event.preventDefault();
      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      glide.track(dragKind, deltaX, deltaY);
    },
    end: (event) => {
      if (event.pointerId !== activePointerId) return;
      if (event.type === 'pointercancel') glide.stop();
      activePointerId = null;
      dragKind = null;
      canvas.releasePointerCapture?.(event.pointerId);
    },
    stopGlide: glide.stop,
  };
}

export function measureViewport(canvas: HTMLCanvasElement): Cut3DViewportSize {
  const rect = canvas.getBoundingClientRect();
  return {
    widthPx: Math.max(MIN_VIEWPORT_PX, Math.round(rect.width || canvas.width)),
    heightPx: Math.max(MIN_VIEWPORT_PX, Math.round(rect.height || canvas.height)),
    pixelRatio: Math.max(1, window.devicePixelRatio),
  };
}

// Where the pointer is over the view, in normalised device coordinates.
function cursorNdc(canvas: HTMLCanvasElement, event: MouseEvent): Viewer3DZoomCursor {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(MIN_VIEWPORT_PX, rect.width);
  const height = Math.max(MIN_VIEWPORT_PX, rect.height);
  return {
    ndcX: clampNdc(((event.clientX - rect.left) / width) * 2 - 1),
    ndcY: clampNdc(1 - ((event.clientY - rect.top) / height) * 2),
  };
}

function clampNdc(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
}

// The shared mouse map of every 3D view (ADR-426); the wheel zooms.
function dragKindForButton(button: number): DragKind | null {
  const action = viewer3dDragAction(button);
  if (action === null) return null;
  return action === 'orbit' ? 'rotate' : 'pan';
}

function controlForDrag(kind: DragKind, deltaX: number, deltaY: number): Cut3DOffscreenControl {
  return { kind, deltaX, deltaY };
}
