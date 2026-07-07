import { act, useRef, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { useWorkspaceWheelZoom } from './use-workspace-wheel';

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
  readonly addEventListenerSpy: ReturnType<typeof vi.spyOn>;
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
