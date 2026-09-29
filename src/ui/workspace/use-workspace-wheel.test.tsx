import { act, useRef, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { useWorkspaceWheelZoom, wheelZoomSteps, type WheelZoomInput } from './use-workspace-wheel';

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

  // ADR-359 Amendment 2: a trackpad sends a stream of small deltas, dozens a
  // second. Each used to zoom a full 1.1x step; now each zooms by its fraction
  // of a 100 px notch.
  it('zooms a delta smaller than a notch by its fraction of a step', async () => {
    const { canvas } = await renderHarness();
    await wheel(canvas, { deltaY: 4 });
    expect(useUiStore.getState().zoomFactor).toBeCloseTo(1.1 ** -0.04, 12);
    for (let event = 0; event < 26; event += 1) await wheel(canvas, { deltaY: -4 });
    // 104 px of trackpad scroll in all: one step in, net of the first 4 px out.
    expect(useUiStore.getState().zoomFactor).toBeCloseTo(1.1, 10);
  });

  it('follows a trackpad pinch, which Chromium sends as ctrl+wheel with deltaY -100 ln(scale)', async () => {
    const { canvas } = await renderHarness();
    await wheel(canvas, { deltaY: -100 * Math.log(1.25), ctrlKey: true });
    expect(useUiStore.getState().zoomFactor).toBeCloseTo(1.25, 10);
    for (let event = 0; event < 10; event += 1) {
      await wheel(canvas, { deltaY: 10 * Math.log(1.25), ctrlKey: true });
    }
    expect(useUiStore.getState().zoomFactor).toBeCloseTo(1, 10);
  });

  it('zooms one step for a Ctrl+wheel mouse notch, like a plain notch', async () => {
    const { canvas } = await renderHarness();
    await wheel(canvas, { deltaY: -100, ctrlKey: true });
    expect(useUiStore.getState().zoomFactor).toBeCloseTo(1.1, 12);
  });

  it('notifies store subscribers once per wheel event', async () => {
    const { canvas } = await renderHarness();
    const listener = vi.fn();
    const unsubscribe = useUiStore.subscribe(listener);
    await wheel(canvas, { deltaY: -100 });
    unsubscribe();
    // Zoom and pan land together, and the closed context bar is not set again.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().zoomFactor).toBeCloseTo(1.1, 12);
  });
});

describe('wheelZoomSteps', () => {
  const event = (patch: Partial<WheelZoomInput>): WheelZoomInput => ({
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    ...patch,
  });

  it('zooms exactly one step per notch in pixel, line and page deltas, in when scrolling up', () => {
    expect(wheelZoomSteps(event({ deltaY: -100 }))).toBe(1);
    expect(wheelZoomSteps(event({ deltaY: 100 }))).toBe(-1);
    expect(wheelZoomSteps(event({ deltaY: -3, deltaMode: 1 }))).toBe(1);
    expect(wheelZoomSteps(event({ deltaY: 3, deltaMode: 1 }))).toBe(-1);
    expect(wheelZoomSteps(event({ deltaY: -1, deltaMode: 2 }))).toBe(1);
    expect(wheelZoomSteps(event({ deltaY: 1, deltaMode: 2 }))).toBe(-1);
  });

  it('counts every notch a merged event carries', () => {
    expect(wheelZoomSteps(event({ deltaY: -200 }))).toBe(2);
    expect(wheelZoomSteps(event({ deltaY: 6, deltaMode: 1 }))).toBe(-2);
    expect(wheelZoomSteps(event({ deltaY: -300, ctrlKey: true }))).toBe(3);
  });

  it('zooms a sub-notch delta in proportion, with no minimum step', () => {
    expect(wheelZoomSteps(event({ deltaY: 4 }))).toBeCloseTo(-0.04, 12);
    expect(wheelZoomSteps(event({ deltaY: -0.5 }))).toBeCloseTo(0.005, 12);
    expect(wheelZoomSteps(event({ deltaY: -50 }))).toBeCloseTo(0.5, 12);
    expect(wheelZoomSteps(event({ deltaY: 1, deltaMode: 1 }))).toBeCloseTo(-1 / 3, 12);
  });

  it('gives a pinch the gain that makes it zoom by the scale the trackpad measured', () => {
    for (const scale of [0.9, 0.99, 1.01, 1.1, 1.5]) {
      const steps = wheelZoomSteps(event({ deltaY: -100 * Math.log(scale), ctrlKey: true }));
      expect(1.1 ** steps).toBeCloseTo(scale, 12);
    }
    // Pinch gain only for small pixel deltas: not for a mouse notch or line mode.
    expect(wheelZoomSteps(event({ deltaY: -100, ctrlKey: true }))).toBe(1);
    expect(wheelZoomSteps(event({ deltaY: -1, deltaMode: 1, ctrlKey: true }))).toBeCloseTo(1 / 3);
  });

  it('stays within ten steps and ignores a delta that is not a number', () => {
    expect(wheelZoomSteps(event({ deltaY: 50_000 }))).toBe(-10);
    expect(wheelZoomSteps(event({ deltaY: -50_000 }))).toBe(10);
    expect(wheelZoomSteps(event({ deltaY: Number.NEGATIVE_INFINITY }))).toBe(10);
    expect(wheelZoomSteps(event({ deltaY: Number.NaN }))).toBe(0);
    expect(wheelZoomSteps(event({ deltaY: 0 }))).toBe(0);
  });
});

async function wheel(
  canvas: HTMLCanvasElement,
  init: { readonly deltaY: number; readonly ctrlKey?: boolean },
): Promise<void> {
  await act(async () => {
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
        ...init,
      }),
    );
  });
}

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
