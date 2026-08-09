import type { Cut3DOffscreenControl } from './cut3d-offscreen-worker-protocol';
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

type DragKind = 'pan' | 'rotate' | 'zoom';

const LEFT_BUTTON = 0;
const MIDDLE_BUTTON = 1;
const RIGHT_BUTTON = 2;
const MIN_VIEWPORT_PX = 1;

/** Proxies only compact pointer, wheel, and viewport values into the worker. */
export function createCut3DOffscreenInput(
  canvas: HTMLCanvasElement,
  onControl: (control: Cut3DOffscreenControl) => void,
  onResize: (size: Cut3DViewportSize) => void,
): Cut3DOffscreenInput {
  let activePointerId: number | null = null;
  let dragKind: DragKind | null = null;
  let lastX = 0;
  let lastY = 0;
  let observer: ResizeObserver | null = null;
  let disposeKeyboard: (() => void) | null = null;
  let isStarted = false;

  const handlePointerDown = (event: PointerEvent): void => {
    const nextKind = dragKindForButton(event.button);
    if (nextKind === null) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    dragKind = nextKind;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId || dragKind === null) return;
    event.preventDefault();
    const deltaX = event.clientX - lastX;
    const deltaY = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    onControl(controlForDrag(dragKind, deltaX, deltaY));
  };
  const handlePointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    dragKind = null;
    canvas.releasePointerCapture?.(event.pointerId);
  };
  const handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    onControl({ kind: 'zoom', deltaY: event.deltaY });
  };
  const preventContextMenu = (event: Event): void => event.preventDefault();
  const sendCurrentSize = (): void => onResize(measureViewport(canvas));

  return {
    start: () => {
      if (isStarted) return;
      isStarted = true;
      canvas.addEventListener('pointerdown', handlePointerDown);
      canvas.addEventListener('pointermove', handlePointerMove);
      canvas.addEventListener('pointerup', handlePointerEnd);
      canvas.addEventListener('pointercancel', handlePointerEnd);
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      disposeKeyboard = installViewer3DKeyboardInput(canvas, onControl);
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
      observer?.disconnect();
      observer = null;
      window.removeEventListener('resize', sendCurrentSize);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerEnd);
      canvas.removeEventListener('pointercancel', handlePointerEnd);
      canvas.removeEventListener('wheel', handleWheel);
      disposeKeyboard?.();
      disposeKeyboard = null;
      canvas.removeEventListener('contextmenu', preventContextMenu);
    },
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

function dragKindForButton(button: number): DragKind | null {
  if (button === LEFT_BUTTON) return 'pan';
  if (button === MIDDLE_BUTTON) return 'zoom';
  if (button === RIGHT_BUTTON) return 'rotate';
  return null;
}

function controlForDrag(kind: DragKind, deltaX: number, deltaY: number): Cut3DOffscreenControl {
  return kind === 'zoom' ? { kind, deltaY } : { kind, deltaX, deltaY };
}
