import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRef } from 'react';
import {
  CANVAS_FALLBACK_HEIGHT,
  CANVAS_FALLBACK_WIDTH,
  useCanvasBitmapSize,
} from './use-canvas-bitmap-size';

function Probe(): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const size = useCanvasBitmapSize(ref);
  return <canvas ref={ref} width={size.width} height={size.height} data-testid="c" />;
}

type RoCallback = () => void;

describe('useCanvasBitmapSize', () => {
  let container: HTMLDivElement;
  let root: Root;
  let roCallbacks: RoCallback[];
  let disconnects: number;
  let measured: { width: number; height: number };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    roCallbacks = [];
    disconnects = 0;
    measured = { width: 1000, height: 700 };
    // jsdom has neither layout nor ResizeObserver — stub both.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: RoCallback) {
          roCallbacks.push(cb);
        }
        observe(): void {
          /* the stub fires callbacks manually via roCallbacks */
        }
        disconnect(): void {
          disconnects += 1;
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          width: measured.width,
          height: measured.height,
          top: 0,
          left: 0,
          right: measured.width,
          bottom: measured.height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('adopts the measured CSS size as the bitmap size on mount', () => {
    act(() => root.render(<Probe />));
    const canvas = container.querySelector('canvas');
    expect(canvas?.width).toBe(1000);
    expect(canvas?.height).toBe(700);
  });

  it('tracks resize-observer notifications', () => {
    act(() => root.render(<Probe />));
    measured = { width: 512, height: 384 };
    act(() => roCallbacks.forEach((cb) => cb()));
    const canvas = container.querySelector('canvas');
    expect(canvas?.width).toBe(512);
    expect(canvas?.height).toBe(384);
  });

  it('keeps the fallback size while the element is unmeasurable (jsdom, display:none)', () => {
    measured = { width: 0, height: 0 };
    act(() => root.render(<Probe />));
    const canvas = container.querySelector('canvas');
    expect(canvas?.width).toBe(CANVAS_FALLBACK_WIDTH);
    expect(canvas?.height).toBe(CANVAS_FALLBACK_HEIGHT);
  });

  it('disconnects the observer on unmount', () => {
    act(() => root.render(<Probe />));
    act(() => root.unmount());
    expect(disconnects).toBe(1);
  });
});
