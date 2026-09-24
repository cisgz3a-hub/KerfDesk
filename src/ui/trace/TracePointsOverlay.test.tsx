import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TracePointsOverlay } from './TracePointsOverlay';
import * as painter from './trace-points-canvas';

let host: HTMLDivElement;
let artwork: HTMLDivElement;
let root: Root;
let frame: FrameRequestCallback | undefined;
let resize: ResizeObserverCallback;
let rect: DOMRect;
let disconnected: ReturnType<typeof vi.fn>;
const paths = [{ color: '#000000', polylines: [{ closed: false, points: [{ x: 75, y: 30 }] }] }];

beforeEach(() => {
  host = document.createElement('div');
  host.className = 'lf-trace-preview__viewport';
  artwork = document.createElement('div');
  host.append(artwork);
  document.body.append(host);
  root = createRoot(artwork);
  rect = rectangle(0, 0, 400, 200);
  artwork.getBoundingClientRect = () => rect;
  host.getBoundingClientRect = () => rectangle(0, 0, 200, 100);
  Object.defineProperties(host, { clientWidth: { value: 200 }, clientHeight: { value: 100 } });
  disconnected = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe(): void {
        /* Rectangles are supplied by this layout fixture. */
      }
      disconnect = disconnected;
    },
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(painter, 'paintTracePoints');
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  frame = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps one viewport canvas and repaints source coordinates after zoom, pan and resize', async () => {
  await act(async () => root.render(<TracePointsOverlay paths={paths} width={100} height={50} />));
  paint();
  const canvas = host.querySelector('canvas');
  expect(canvas?.width).toBe(200 * window.devicePixelRatio);
  expect(canvas?.height).toBe(100 * window.devicePixelRatio);
  expect(painter.paintTracePoints).toHaveBeenLastCalledWith(
    expect.anything(),
    paths,
    { left: 0, top: 0, width: 200, height: 100, scaleX: 4, scaleY: 4 },
    expect.any(Number),
    expect.any(String),
  );
  rect = rectangle(-200, -80, 800, 400);
  host.dispatchEvent(new Event('scroll'));
  host.dispatchEvent(new Event('scroll'));
  expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  paint();
  expect(painter.paintTracePoints).toHaveBeenLastCalledWith(
    expect.anything(),
    paths,
    { left: 200, top: 80, width: 200, height: 100, scaleX: 8, scaleY: 8 },
    expect.any(Number),
    expect.any(String),
  );
  expect(canvas?.style.left).toBe('200px');
  expect(canvas?.style.top).toBe('80px');
  rect = rectangle(0, 0, 100, 50);
  resize([], {} as ResizeObserver);
  paint();
  expect(canvas?.width).toBeLessThan(200);
  expect(host.querySelectorAll('canvas')).toHaveLength(1);
  expect(host.querySelector('canvas')).toBe(canvas);
  expect(canvas?.children).toHaveLength(0);
});

it('retires resize and scroll work when the overlay is removed', async () => {
  await act(async () => root.render(<TracePointsOverlay paths={paths} width={100} height={50} />));
  await act(async () => root.render(null));
  expect(disconnected).toHaveBeenCalledTimes(1);
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  const scheduled = vi.mocked(requestAnimationFrame).mock.calls.length;
  host.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new Event('resize'));
  expect(requestAnimationFrame).toHaveBeenCalledTimes(scheduled);
});

function paint(): void {
  const callback = frame;
  frame = undefined;
  if (callback === undefined) throw new Error('No scheduled paint');
  callback(0);
}

function rectangle(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
}
