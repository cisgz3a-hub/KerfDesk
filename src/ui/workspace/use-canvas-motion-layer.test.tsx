import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createProject } from '../../core/scene';
import type { CanvasMotionOverlay } from './draw-canvas-motion';
import { hatchPlan, liveRun } from './motion-route-fixture.test-support';
import { InkPath2D } from './motion-route-ink.test-support';
import { resetRouteRastersForTests, ROUTE_RASTER_SETTLE_MS } from './motion-route-raster';
import { useCanvasBitmapSize } from './use-canvas-bitmap-size';
import { useCanvasMotionLayer } from './use-canvas-motion-layer';
import type { ViewState } from './view-transform';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const project = createProject();

// A fresh plan per test: route rasters are cached per plan identity.
function motionOverlay(): CanvasMotionOverlay {
  const plan = hatchPlan({ rows: 20, segmentsPerRow: 10 });
  return { plan, run: liveRun(plan, plan.manifest.totalRouteMm / 2), showStartMarkers: false };
}

function Layer(props: {
  readonly viewState: ViewState;
  readonly overlay: CanvasMotionOverlay;
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const canvasSize = useCanvasBitmapSize(ref);
  useCanvasMotionLayer({
    ref,
    project,
    viewState: props.viewState,
    canvasSize,
    overlay: props.overlay,
  });
  return <canvas ref={ref} width={canvasSize.width} height={canvasSize.height} />;
}

describe('useCanvasMotionLayer', () => {
  let container: HTMLDivElement;
  let root: Root;
  let measured: { width: number; height: number };
  let rasterCanvases: number;
  let blits: number[][];
  let overlay: CanvasMotionOverlay;
  const clock = { now: 1_000 };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    measured = { width: 640, height: 480 };
    rasterCanvases = 0;
    blits = [];
    overlay = motionOverlay();
    resetRouteRastersForTests();
    vi.stubGlobal('Path2D', InkPath2D);
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ ...measured, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 }) as DOMRect,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function context(
      this: HTMLCanvasElement,
    ) {
      // The route's offscreen rasters are never attached to the document.
      if (!this.isConnected) rasterCanvases += 1;
      return recordingContext(this, (args) => {
        if (this.isConnected) blits.push(args);
      });
    } as unknown as HTMLCanvasElement['getContext']);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetRouteRastersForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('paints the route once on mount, at the measured size, not first at 800x600', () => {
    act(() =>
      root.render(<Layer viewState={{ zoomFactor: 1, panX: 0, panY: 0 }} overlay={overlay} />),
    );

    expect(rasterCanvases).toBe(1);
    expect(blits).toEqual([[0, 0]]);
  });

  it('does not paint the route into the unmeasured placeholder bitmap', () => {
    measured = { width: 0, height: 0 };
    act(() =>
      root.render(<Layer viewState={{ zoomFactor: 1, panX: 0, panY: 0 }} overlay={overlay} />),
    );

    expect(rasterCanvases).toBe(0);
    expect(blits).toEqual([]);
  });

  it('repaints by itself once a zoom settles, without another render', () => {
    act(() =>
      root.render(<Layer viewState={{ zoomFactor: 1, panX: 0, panY: 0 }} overlay={overlay} />),
    );
    act(() =>
      root.render(<Layer viewState={{ zoomFactor: 1.2, panX: 0, panY: 0 }} overlay={overlay} />),
    );
    expect(blits.at(-1)).toHaveLength(4);

    act(() => {
      clock.now += ROUTE_RASTER_SETTLE_MS;
      vi.advanceTimersByTime(ROUTE_RASTER_SETTLE_MS);
    });

    expect(blits.at(-1)).toEqual([0, 0]);
    expect(rasterCanvases).toBe(2);
  });
});

function recordingContext(
  canvas: HTMLCanvasElement,
  onBlit: (args: number[]) => void,
): CanvasRenderingContext2D {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'canvas') return canvas;
        if (property === 'globalAlpha') return 1;
        if (property === 'measureText') return () => ({ width: 0 });
        if (property === 'drawImage') {
          return (_source: unknown, ...args: number[]) => onBlit(args);
        }
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
}
