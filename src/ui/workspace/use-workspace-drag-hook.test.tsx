import { act, useCallback, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
  type Vec2,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { computeView } from './view-transform';
import { useDragMove } from './use-workspace-drag';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CANVAS_SIZE_PX = 200;
const VIEW_STATE = { zoomFactor: 1, panX: 0, panY: 0 };

const mountedRoots: Root[] = [];

beforeEach(() => {
  resetStore();
  useUiStore.setState({
    draftShape: null,
    measureDraft: null,
    selectionMarquee: null,
    snapGuides: [],
    spaceDown: false,
    toolMode: { kind: 'select' },
    workspaceContextBar: null,
    zoomFactor: 1,
    panX: 0,
    panY: 0,
  });
});

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
});

describe('useDragMove hook event pipeline', () => {
  it('runs measure drag through mouse down, move, and up handlers', async () => {
    useUiStore.getState().setToolMode({ kind: 'measure' });
    const { canvas } = await renderHarness();

    await dispatchMouse(canvas, 'mousedown', { clientX: 60, clientY: 60 });
    expect(useUiStore.getState().measureDraft).toEqual({
      start: expect.any(Object),
      end: expect.any(Object),
    });

    await dispatchMouse(canvas, 'mousemove', { clientX: 90, clientY: 100 });
    const duringMove = useUiStore.getState().measureDraft;
    expect(useStore.getState().cursorMm).not.toBeNull();
    expect(duringMove?.end).not.toEqual(duringMove?.start);

    await dispatchMouse(canvas, 'mouseup', { clientX: 110, clientY: 120 });
    expect(useStore.getState().cursorMm).toBeNull();
    expect(useUiStore.getState().measureDraft?.end).not.toEqual(
      useUiStore.getState().measureDraft?.start,
    );
  });

  it('finalizes an object drag on mouse leave', async () => {
    const project = projectWithRectangle();
    useStore.getState().setProject(project);
    useStore.getState().selectObject('rect');
    const { canvas } = await renderHarness();
    const start = clientForScenePoint(project, { x: 50, y: 50 });
    const end = clientForScenePoint(project, { x: 70, y: 80 });

    await dispatchMouse(canvas, 'mousedown', start);
    expect(canvas.dataset.dragKind).toBe('move');
    expect(useStore.getState().pendingUndo).not.toBeNull();

    await dispatchMouse(canvas, 'mousemove', end);
    const moved = useStore.getState().project.scene.objects.find((object) => object.id === 'rect');
    expect(moved?.transform.x).toBeCloseTo(40);
    expect(moved?.transform.y).toBeCloseTo(50);

    await dispatchMouse(canvas, 'mouseout', end);
    expect(canvas.dataset.dragKind).toBe('');
    expect(useStore.getState().pendingUndo).toBeNull();
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});

function DragHarness(props: { readonly previewMode?: boolean }): JSX.Element {
  const project = useStore((state) => state.project);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    ref.current = node;
    if (node !== null) installCanvasRect(node);
  }, []);
  const { handlers, dragKind } = useDragMove(ref, project, props.previewMode ?? false, VIEW_STATE);
  return (
    <canvas
      ref={setCanvasRef}
      width={CANVAS_SIZE_PX}
      height={CANVAS_SIZE_PX}
      data-drag-kind={dragKind ?? ''}
      onMouseDown={handlers.onMouseDown}
      onMouseMove={handlers.onMouseMove}
      onMouseUp={handlers.onMouseUp}
      onMouseLeave={handlers.onMouseUp}
      aria-label="drag hook test canvas"
    />
  );
}

async function renderHarness(): Promise<{ readonly canvas: HTMLCanvasElement }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  await act(async () => {
    root.render(<DragHarness />);
  });
  const canvas = host.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('drag harness canvas missing');
  return { canvas };
}

async function dispatchMouse(
  target: HTMLCanvasElement,
  type: 'mousedown' | 'mousemove' | 'mouseup' | 'mouseout',
  init: { readonly clientX: number; readonly clientY: number },
): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: init.clientX,
        clientY: init.clientY,
      }),
    );
  });
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

function clientForScenePoint(
  project: Project,
  point: Vec2,
): { readonly clientX: number; readonly clientY: number } {
  const view = computeView(
    CANVAS_SIZE_PX,
    CANVAS_SIZE_PX,
    project.device.bedWidth,
    project.device.bedHeight,
    VIEW_STATE,
  );
  return {
    clientX: view.offsetX + point.x * view.scale,
    clientY: view.offsetY + point.y * view.scale,
  };
}

function projectWithRectangle(): Project {
  const rect = createRectangle({
    id: 'rect',
    color: '#000000',
    spec: { widthMm: 60, heightMm: 60, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
  });
  return {
    ...createProject(),
    scene: {
      objects: [rect],
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [],
    },
  };
}
