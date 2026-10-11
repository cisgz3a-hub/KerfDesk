import { act, useCallback, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import type { Vec2 } from '../../core/scene';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { useDragMove } from './use-workspace-drag';
import { useTracePartSelection } from './use-trace-part-selection';
import { computeView } from './view-transform';

const CANVAS_SIZE = 1000;
const VIEW = { zoomFactor: 1, panX: 0, panY: 0 };
const roots: Root[] = [];

export async function cleanupTracePartHarness(): Promise<void> {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
}

function DragHarness(): JSX.Element {
  const project = useStore((state) => state.project);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const setCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (canvas === null) return;
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANVAS_SIZE, height: CANVAS_SIZE }) as DOMRect;
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();
    canvas.hasPointerCapture = () => true;
  }, []);
  const { handlers } = useDragMove(canvasRef, project, false, VIEW);
  return <canvas ref={setCanvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} {...handlers} />;
}

function SelectionGuard(): null {
  const active = useUiStore((state) => state.toolMode.kind === 'trace-parts');
  useTracePartSelection(active);
  return null;
}

export async function renderHarness(guardSelection = false): Promise<HTMLCanvasElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <>
        <DragHarness />
        {guardSelection ? <SelectionGuard /> : null}
      </>,
    ),
  );
  const canvas = host.querySelector('canvas');
  if (canvas === null) throw new Error('canvas missing');
  return canvas;
}

export async function pointer(
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  point: Vec2,
  modifiers: { readonly shiftKey?: boolean; readonly button?: number } = {},
): Promise<void> {
  const device = useStore.getState().project.device;
  const view = computeView(CANVAS_SIZE, CANVAS_SIZE, device.bedWidth, device.bedHeight, VIEW);
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: view.offsetX + point.x * view.scale,
    clientY: view.offsetY + point.y * view.scale,
    ...modifiers,
  });
  Object.defineProperty(event, 'pointerId', { value: 3 });
  await act(async () => canvas.dispatchEvent(event));
}
