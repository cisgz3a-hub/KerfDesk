import { act, useRef, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { useWorkspaceWheelZoom, wheelZoomSteps } from './use-workspace-wheel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CANVAS_SIZE_PX = 200;
const mountedRoots: Root[] = [];

beforeEach(() => {
  resetStore();
  useUiStore.setState({ zoomFactor: 1, panX: 0, panY: 0, workspaceContextBar: null });
});

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
});

describe('useWorkspaceWheelZoom', () => {
  it('registers the wheel listener as non-passive so preventDefault works', async () => {
    const { addEventListenerSpy } = await renderHarness();
    const wheelCall = addEventListenerSpy.mock.calls.find(([type]) => type === 'wheel');
    expect(wheelCall).toBeDefined();
    expect(wheelCall?.[2]).toEqual({ passive: false });
  });

  it('zooms in at the cursor and calls preventDefault on wheel-up', async () => {
    const { canvas } = await renderHarness();
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
      clientX: 100,
      clientY: 100,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    await act(async () => {
      canvas.dispatchEvent(event);
    });
    expect(preventSpy).toHaveBeenCalled();
    expect(useUiStore.getState().zoomFactor).toBeGreaterThan(1);
  });

  it('zooms out on wheel-down', async () => {
    const { canvas } = await renderHarness();
    await act(async () => {
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 100,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    expect(useUiStore.getState().zoomFactor).toBeLessThan(1);
  });

  it('does not zoom or pan for horizontal-only wheel input', async () => {
    useUiStore.setState({ zoomFactor: 2, panX: 7, panY: -3 });
    const { canvas } = await renderHarness();

    await act(async () => {
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: 120,
          deltaY: 0,
          clientX: 25,
          clientY: 175,
        }),
      );
    });

    expect(useUiStore.getState()).toMatchObject({ zoomFactor: 2, panX: 7, panY: -3 });
  });

  // Chromium merges wheel events that queue during a slow frame into one event
  // with the summed delta. Counting only the sign dropped those notches: ten
  // notches spun over a large picture zoomed six steps (measured 2026-09-29).
  it('zooms by every notch a coalesced wheel event carries', async () => {
    const { canvas } = await renderHarness();
    await act(async () => {
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: -300,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    expect(useUiStore.getState().zoomFactor).toBeCloseTo(1.1 ** 3, 10);
  });

  it('still zooms one step for a delta smaller than a notch', async () => {
    const { canvas } = await renderHarness();
    await act(async () => {
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 4,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    expect(useUiStore.getState().zoomFactor).toBeCloseTo(1 / 1.1, 10);
  });
});

describe('wheelZoomSteps', () => {
  it('counts notches in pixel, line and page deltas', () => {
    expect(wheelZoomSteps({ deltaY: 100, deltaMode: 0 })).toBe(1);
    expect(wheelZoomSteps({ deltaY: -200, deltaMode: 0 })).toBe(2);
    expect(wheelZoomSteps({ deltaY: 6, deltaMode: 1 })).toBe(2);
    expect(wheelZoomSteps({ deltaY: -1, deltaMode: 2 })).toBe(1);
  });

  it('never drops below one step or runs away on a huge delta', () => {
    expect(wheelZoomSteps({ deltaY: 0.5, deltaMode: 0 })).toBe(1);
    expect(wheelZoomSteps({ deltaY: 50_000, deltaMode: 0 })).toBe(10);
    expect(wheelZoomSteps({ deltaY: Number.NaN, deltaMode: 0 })).toBe(1);
  });
});

function WheelHarness(): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    ref.current = node;
    if (node !== null) installCanvasRect(node);
  }, []);
  useWorkspaceWheelZoom(ref);
  return (
    <canvas
      ref={setCanvasRef}
      width={CANVAS_SIZE_PX}
      height={CANVAS_SIZE_PX}
      aria-label="wheel hook test canvas"
    />
  );
}

async function renderHarness(): Promise<{
  readonly canvas: HTMLCanvasElement;
  readonly addEventListenerSpy: MockInstance<HTMLCanvasElement['addEventListener']>;
}> {
  const addEventListenerSpy = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  await act(async () => {
    root.render(<WheelHarness />);
  });
  const canvas = host.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('wheel harness canvas missing');
  return { canvas, addEventListenerSpy };
}

function installCanvasRect(canvas: HTMLCanvasElement): void {
  canvas.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: CANVAS_SIZE_PX,
      bottom: CANVAS_SIZE_PX,
      width: CANVAS_SIZE_PX,
      height: CANVAS_SIZE_PX,
      toJSON: () => ({}),
    }) as DOMRect;
}
