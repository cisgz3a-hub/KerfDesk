// Shared jsdom harness for the trace preview's zoom and pan tests: a ready
// 200x100 trace in a measured 300x200 viewport, plus event helpers.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { TracePreview } from './TracePreview';
import { LIVE_ZOOM_SETTLE_MS } from './trace-preview-zoom';
import type { TracePreviewState } from './use-trace-preview';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ready: TracePreviewState = {
  kind: 'ready',
  svg: '<svg viewBox="0 0 200 100"><path id="nav-line" d="M20 10L60 40"/></svg>',
  width: 200,
  height: 100,
  paths: [
    {
      // eslint-disable-next-line no-restricted-syntax -- traced scene-data colour, not UI chrome
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 20, y: 10 },
            { x: 60, y: 40 },
          ],
        },
      ],
    },
  ],
};

type ImageSize = { readonly width: number; readonly height: number };
type BoundaryListener = (...args: never[]) => void;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let onBoundaryChange: BoundaryListener = () => undefined;

export function previewHost(): HTMLDivElement {
  if (host === null) throw new Error('Preview not mounted');
  return host;
}

/** Mount the preview and give its viewport a 300x200 size at the window origin. */
export async function mountNavigationPreview(listener: BoundaryListener): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onBoundaryChange = listener;
  await renderNavigationPreview({ width: 200, height: 100 });
  // jsdom has no layout.
  await resizeViewport(300, 200);
}

export async function renderNavigationPreview(imageSize: ImageSize): Promise<void> {
  const mounted = root;
  if (mounted === null) throw new Error('Preview not mounted');
  await act(async () =>
    mounted.render(
      createElement(TracePreview, {
        state: ready,
        sourceDataUrl: 'data:image/png;base64,AAA',
        imageSize,
        onBoundaryChange,
      }),
    ),
  );
}

export async function unmountNavigationPreview(): Promise<void> {
  const mounted = root;
  if (mounted !== null) await act(async () => mounted.unmount());
  host?.remove();
  root = null;
  host = null;
}

export function viewport(): HTMLDivElement {
  return previewHost().querySelector('[aria-label="Preview viewport"]') as HTMLDivElement;
}

export function stage(): HTMLDivElement {
  return previewHost().querySelector('[aria-label="Trace preview"]') as HTMLDivElement;
}

/** The artwork layer a live wheel/pinch step scales. */
export function lens(): HTMLDivElement {
  return stage().firstElementChild as HTMLDivElement;
}

export async function settleLive(): Promise<void> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, LIVE_ZOOM_SETTLE_MS + 30)));
}

export function button(label: string): HTMLButtonElement {
  const found = [...previewHost().querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === label || node.textContent === label,
  );
  if (found === undefined) throw new Error(`Missing button: ${label}`);
  return found;
}

export async function click(label: string): Promise<void> {
  await act(async () => button(label).click());
}

export async function key(value: string): Promise<void> {
  await act(async () =>
    viewport().dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
    ),
  );
}

export async function resizeViewport(width: number, height: number): Promise<void> {
  Object.defineProperties(viewport(), {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
  const rect = { left: 0, top: 0, width, height, right: width, bottom: height } as DOMRect;
  viewport().getBoundingClientRect = () => rect;
  stage().getBoundingClientRect = () => rect;
  await act(async () => window.dispatchEvent(new Event('resize')));
}

let wheelClock = 1_000;
export async function wheel(init: WheelEventInit, gapMs = 1_000): Promise<WheelEvent> {
  wheelClock += gapMs;
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'timeStamp', { value: wheelClock });
  await act(async () => stage().dispatchEvent(event));
  return event;
}

// jsdom has no PointerEvent; a MouseEvent with pointer fields exercises the same handlers.
export async function pointer(
  type: string,
  init: {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly button?: number;
    /** Pressed-button mask; defaults to the `button` held for down and move. */
    readonly buttons?: number;
    readonly type?: 'mouse' | 'touch';
  },
): Promise<void> {
  const held = type === 'pointerdown' || type === 'pointermove';
  const pressed = (init.button ?? 0) === 1 ? 4 : 1;
  const event = new MouseEvent(type, {
    bubbles: type !== 'pointerenter',
    cancelable: true,
    button: init.button ?? 0,
    buttons: init.buttons ?? (held ? pressed : 0),
    clientX: init.x,
    clientY: init.y,
  });
  Object.defineProperties(event, {
    pointerId: { value: init.id },
    pointerType: { value: init.type ?? 'mouse' },
  });
  await act(async () => (type === 'pointerenter' ? viewport() : stage()).dispatchEvent(event));
}

export async function mouse(type: string, x: number, y: number): Promise<void> {
  await act(async () =>
    stage().dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
    ),
  );
}
