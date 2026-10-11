import { act, useCallback, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTransform, createLayer, IDENTITY_TRANSFORM, type Vec2 } from '../../core/scene';
import { focusDesignHierarchy } from '../state/design-hierarchy-store';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { DEFAULT_SNAP_SETTINGS } from './snap-settings';
import { activateTracePartTool } from './trace-part-tool';
import { expectTransform, getTrace, loadTrace, selectedTrace } from './trace-part-test-fixtures';
import { useDragMove } from './use-workspace-drag';
import { useTracePartSelection } from './use-trace-part-selection';
import { computeView } from './view-transform';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CANVAS_SIZE = 1000;
const VIEW = { zoomFactor: 1, panX: 0, panY: 0 };
const roots: Root[] = [];

beforeEach(() => {
  resetStore();
  focusDesignHierarchy(null, 0);
  useUiStore.setState({
    toolMode: { kind: 'trace-parts' },
    spaceDown: false,
    snapSettings: { ...DEFAULT_SNAP_SETTINGS, enabled: false },
    snapMarker: null,
    snapGuides: [],
  });
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
});

describe('trace-part dragging through the workspace pointer pipeline', () => {
  it('separates and moves the picked contour while keeping every other contour unchanged, in one Undo', async () => {
    loadTrace();
    const original = useStore.getState().project;
    const originalTrace = getTrace('trace');
    const canvas = await renderHarness();
    await pointer(canvas, 'pointerdown', { x: 30, y: 55 });
    const part = selectedTrace();
    expect(part.paths[0]?.curves).toEqual(originalTrace.paths[0]?.curves?.slice(0, 1));
    expect(getTrace('trace').paths[0]?.curves).toEqual(originalTrace.paths[0]?.curves?.slice(1));
    expect(useStore.getState().undoStack).toHaveLength(0);
    await pointer(canvas, 'pointermove', { x: 37, y: 51 });
    expectTransform(selectedTrace().transform, { ...IDENTITY_TRANSFORM, x: 7, y: -4 });
    expect(getTrace('trace').transform).toEqual(originalTrace.transform);
    await pointer(canvas, 'pointermove', { x: 25, y: 64 });
    expectTransform(selectedTrace().transform, { ...IDENTITY_TRANSFORM, x: -5, y: 9 });
    await pointer(canvas, 'pointerup', { x: 25, y: 64 });
    expect(useStore.getState().undoStack).toEqual([original]);
    const moved = useStore.getState().project;
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project).toEqual(original);
    await act(async () => useStore.getState().redo());
    expect(useStore.getState().project).toEqual(moved);
  });

  it('moves a transformed part by scene displacement without changing its local geometry', async () => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      x: 250,
      y: 130,
      scaleX: 1.6,
      scaleY: 0.7,
      mirrorX: true,
      rotationDeg: 25,
    };
    loadTrace(transform);
    const originalTrace = getTrace('trace');
    const grab = applyTransform({ x: 30, y: 55 }, transform);
    const destination = { x: grab.x + 8, y: grab.y - 5 };
    const canvas = await renderHarness();
    await pointer(canvas, 'pointerdown', grab);
    await pointer(canvas, 'pointermove', destination);
    expectTransform(selectedTrace().transform, { ...transform, x: 258, y: 125 });
    expect(selectedTrace().paths[0]?.curves).toEqual(originalTrace.paths[0]?.curves?.slice(0, 1));
    expect(getTrace('trace').transform).toEqual(transform);
    await pointer(canvas, 'pointerup', destination);
  });

  it.each(['Escape', 'pointercancel', 'lostpointercapture'] as const)(
    'fully restores the original compound trace and prior selection on %s',
    async (cancel) => {
      loadTrace();
      useStore.setState({ selectedObjectId: 'trace' });
      const original = useStore.getState().project;
      const canvas = await renderHarness();
      await pointer(canvas, 'pointerdown', { x: 30, y: 55 });
      await pointer(canvas, 'pointermove', { x: 37, y: 51 });
      expect(useStore.getState().project.scene.objects).toHaveLength(2);
      if (cancel === 'Escape') {
        await act(async () =>
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        );
      } else {
        await pointer(canvas, cancel, { x: 37, y: 51 });
      }
      expect(useStore.getState().project).toBe(original);
      expect(useStore.getState().selectedObjectId).toBe('trace');
      expect(useStore.getState().additionalSelectedIds.size).toBe(0);
      expect(useStore.getState().undoStack).toHaveLength(0);
      expect(useStore.getState().pendingUndo).toBeNull();
      expect(useStore.getState().dirty).toBe(false);
      await pointer(canvas, 'pointermove', { x: 70, y: 90 });
      await pointer(canvas, 'pointerup', { x: 70, y: 90 });
      expect(useStore.getState().project).toBe(original);
    },
  );

  it('Shift-selects multiple parts and drags both without moving the remaining trace', async () => {
    loadTrace();
    const canvas = await renderHarness();
    await pointer(canvas, 'pointerdown', { x: 30, y: 55 });
    await pointer(canvas, 'pointerup', { x: 30, y: 55 });
    const firstId = selectedTrace().id;
    await pointer(canvas, 'pointerdown', { x: 110, y: 55 }, { shiftKey: true });
    await pointer(canvas, 'pointerup', { x: 110, y: 55 }, { shiftKey: true });
    const state = useStore.getState();
    const secondId = [...state.additionalSelectedIds][0];
    if (secondId === undefined) throw new Error('second trace part was not selected');
    expect(state.selectedObjectId).toBe(firstId);
    expect(state.project.scene.objects).toHaveLength(3);
    expect(state.pendingUndo).toBeNull();
    const historyBeforeMove = state.undoStack.length;
    await pointer(canvas, 'pointerdown', { x: 30, y: 55 });
    await pointer(canvas, 'pointermove', { x: 35, y: 62 });
    for (const id of [firstId, secondId]) {
      expectTransform(getTrace(id).transform, { ...IDENTITY_TRANSFORM, x: 5, y: 7 });
    }
    expect(getTrace('trace').transform).toEqual(IDENTITY_TRANSFORM);
    await pointer(canvas, 'pointerup', { x: 35, y: 62 });
    expect(useStore.getState().undoStack).toHaveLength(historyBeforeMove + 1);
  });

  it('Shift-removes a selected part without moving or deselecting the other selected part', async () => {
    loadTrace();
    const canvas = await renderHarness();
    await pointer(canvas, 'pointerdown', { x: 30, y: 55 }, { shiftKey: true });
    const firstId = selectedTrace().id;
    await pointer(canvas, 'pointerdown', { x: 110, y: 55 }, { shiftKey: true });
    const before = useStore.getState().project;
    const history = useStore.getState().undoStack.length;
    await pointer(canvas, 'pointerdown', { x: 30, y: 55 }, { shiftKey: true });
    await pointer(canvas, 'pointermove', { x: 45, y: 75 }, { shiftKey: true });
    await pointer(canvas, 'pointerup', { x: 45, y: 75 }, { shiftKey: true });
    expect(useStore.getState().selectedObjectId).not.toBe(firstId);
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(history);
  });

  it.each([2, 3])(
    'Shift-picking with a stale %i-contour whole-trace selection excludes the remainder from the drag',
    async (contours) => {
      loadTrace(IDENTITY_TRANSFORM, contours);
      useStore.setState({ selectedObjectId: 'trace' });
      const canvas = await renderHarness();
      await pointer(canvas, 'pointerdown', { x: 30, y: 55 }, { shiftKey: true });
      await pointer(canvas, 'pointerup', { x: 30, y: 55 }, { shiftKey: true });
      expect(selectedTrace().id).not.toBe('trace');
      expect(useStore.getState().additionalSelectedIds.size).toBe(0);
      const remainder = getTrace('trace');
      expect(remainder.paths[0]?.polylines).toHaveLength(contours - 1);
      await pointer(canvas, 'pointerdown', { x: 30, y: 55 });
      await pointer(canvas, 'pointermove', { x: 36, y: 60 });
      await pointer(canvas, 'pointerup', { x: 36, y: 60 });
      expectTransform(selectedTrace().transform, { ...IDENTITY_TRANSFORM, x: 6, y: 5 });
      expect(getTrace('trace')).toBe(remainder);
    },
  );

  it('selects directly inside a group and keeps its sibling and remaining contours stationary', async () => {
    loadTrace();
    const sibling = {
      ...getTrace('trace'),
      id: 'sibling',
      transform: { ...IDENTITY_TRANSFORM, y: 150 },
    };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: [...state.project.scene.objects, sibling],
          groups: [{ id: 'group', name: 'Artwork', objectIds: ['trace', 'sibling'] }],
        },
      },
    }));
    const canvas = await renderHarness();
    await pointer(canvas, 'pointerdown', { x: 30, y: 55 });
    const partId = selectedTrace().id;
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
    await pointer(canvas, 'pointermove', { x: 38, y: 63 });
    await pointer(canvas, 'pointerup', { x: 38, y: 63 });
    expectTransform(getTrace(partId).transform, { ...IDENTITY_TRANSFORM, x: 8, y: 8 });
    expect(getTrace('sibling')).toBe(sibling);
    expect(getTrace('trace').transform).toEqual(IDENTITY_TRANSFORM);
    expect(useStore.getState().project.scene.groups?.[0]?.objectIds).toContain(partId);
  });

  it('leaves ordinary Select dragging the complete trace as one object', async () => {
    loadTrace();
    useUiStore.setState({ toolMode: { kind: 'select' } });
    const originalPaths = getTrace('trace').paths;
    const canvas = await renderHarness();
    await pointer(canvas, 'pointerdown', { x: 30, y: 55 });
    await pointer(canvas, 'pointermove', { x: 34, y: 61 });
    await pointer(canvas, 'pointerup', { x: 34, y: 61 });
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(getTrace('trace').paths).toBe(originalPaths);
    expectTransform(getTrace('trace').transform, { ...IDENTITY_TRANSFORM, x: 4, y: 6 });
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('picks the corner contour after Undo restores a selected compound trace instead of scaling the whole trace', async () => {
    loadTrace();
    const original = useStore.getState().project;
    const canvas = await renderHarness();
    await pointer(canvas, 'pointerdown', { x: 30, y: 55 });
    await pointer(canvas, 'pointerup', { x: 30, y: 55 });
    await act(async () => {
      useStore.getState().undo();
      useStore.getState().selectTracePart('trace');
    });
    expect(useStore.getState().project).toEqual(original);
    await pointer(canvas, 'pointerdown', { x: 20, y: 40 });
    await pointer(canvas, 'pointermove', { x: 26, y: 44 });
    await pointer(canvas, 'pointerup', { x: 26, y: 44 });
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    expectTransform(selectedTrace().transform, { ...IDENTITY_TRANSFORM, x: 6, y: 4 });
    expect(getTrace('trace').transform).toEqual(IDENTITY_TRANSFORM);
    expect(getTrace('trace').paths[0]?.polylines).toHaveLength(2);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it.each(['locked', 'hidden'] as const)(
    'cannot resize or move a selected part after it becomes %s',
    async (unavailable) => {
      loadTrace();
      const canvas = await renderHarness();
      await pointer(canvas, 'pointerdown', { x: 30, y: 55 });
      await pointer(canvas, 'pointerup', { x: 30, y: 55 });
      const id = selectedTrace().id;
      await act(async () =>
        useStore.setState((state) => ({
          project: {
            ...state.project,
            scene: {
              ...state.project.scene,
              objects: state.project.scene.objects.map((object) =>
                unavailable === 'locked' && object.id === id ? { ...object, locked: true } : object,
              ),
              layers:
                unavailable === 'hidden'
                  ? [{ ...createLayer({ id: 'hidden', color: '#000000' }), visible: false }]
                  : state.project.scene.layers,
            },
          },
        })),
      );
      const original = useStore.getState().project;
      const history = useStore.getState().undoStack.length;
      await pointer(canvas, 'pointerdown', { x: 20, y: 40 });
      await pointer(canvas, 'pointermove', { x: 26, y: 44 });
      await pointer(canvas, 'pointerup', { x: 26, y: 44 });
      expect(useStore.getState().project).toBe(original);
      expect(useStore.getState().undoStack).toHaveLength(history);
      expect(useStore.getState().pendingUndo).toBeNull();
    },
  );

  it('activation clears whole-object handles and toggles back to Select without altering artwork', () => {
    loadTrace();
    useStore.getState().selectObject('trace');
    useUiStore.setState({ toolMode: { kind: 'select' } });
    const original = useStore.getState().project;
    activateTracePartTool();
    expect(useUiStore.getState().toolMode.kind).toBe('trace-parts');
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().project).toBe(original);
    activateTracePartTool();
    expect(useUiStore.getState().toolMode.kind).toBe('select');
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('the selection guard clears a stale compound selection and retains an individually picked part', async () => {
    loadTrace();
    useStore.setState({ selectedObjectId: 'trace' });
    const original = useStore.getState().project;
    const canvas = await renderHarness(true);
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().project).toBe(original);
    expect(useStore.getState().undoStack).toHaveLength(0);
    await pointer(canvas, 'pointerdown', { x: 30, y: 55 });
    const partId = selectedTrace().id;
    await pointer(canvas, 'pointermove', { x: 32, y: 57 });
    await pointer(canvas, 'pointerup', { x: 32, y: 57 });
    expect(selectedTrace().id).toBe(partId);
    await act(async () => {
      useStore.getState().undo();
      useStore.getState().selectTracePart('trace');
    });
    expect(useStore.getState().project).toEqual(original);
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
  });

  it('the selection guard leaves normal Select alone and clears whole-image selection when parts mode activates', async () => {
    loadTrace();
    useUiStore.setState({ toolMode: { kind: 'select' } });
    useStore.setState({ selectedObjectId: 'trace' });
    await renderHarness(true);
    expect(useStore.getState().selectedObjectId).toBe('trace');
    await act(async () => useUiStore.setState({ toolMode: { kind: 'trace-parts' } }));
    expect(useStore.getState().selectedObjectId).toBeNull();
  });
});

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

async function renderHarness(guardSelection = false): Promise<HTMLCanvasElement> {
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

async function pointer(
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  point: Vec2,
  modifiers: { readonly shiftKey?: boolean } = {},
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
