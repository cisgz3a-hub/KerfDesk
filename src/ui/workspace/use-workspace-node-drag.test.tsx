import { act, useCallback, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addObject,
  applyTransform,
  createProject,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ImportedSvg,
  type Transform,
  type Vec2,
} from '../../core/scene';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import { pathNodePoint } from '../state/path-node-edit-geometry';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { DEFAULT_SNAP_SETTINGS } from './snap-settings';
import { useDragMove } from './use-workspace-drag';
import { computeView } from './view-transform';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CANVAS_SIZE = 1000;
const VIEW = { zoomFactor: 1, panX: 0, panY: 0 };
const POINTS = [
  { x: 40, y: 40 },
  { x: 80, y: 40 },
  { x: 80, y: 80 },
];
const roots: Root[] = [];

beforeEach(() => {
  resetStore();
  useUiStore.setState({
    toolMode: { kind: 'node' },
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

describe('selected-node dragging through the workspace pointer pipeline', () => {
  it.each([
    { pointIndex: 0, offset: 0, canonical: false },
    { pointIndex: 1, offset: 0, canonical: false },
    { pointIndex: 0, offset: 0.75, canonical: false },
    { pointIndex: 1, offset: 0.75, canonical: false },
    { pointIndex: 0, offset: 0, canonical: true },
    { pointIndex: 1, offset: 0, canonical: true },
    { pointIndex: 0, offset: 0.75, canonical: true },
    { pointIndex: 1, offset: 0.75, canonical: true },
  ])(
    'moves node $pointIndex with offset $offset (canonical=$canonical) by pointer displacement',
    async ({ pointIndex, offset, canonical }) => {
      loadPaths(canonical);
      selectPair(canonical);
      const original = useStore.getState().project;
      const selection = useStore.getState().selectedPathNodes;
      const primary = useStore.getState().selectedPathNode;
      const grab = plus(POINTS[pointIndex]!, { x: offset, y: -offset });
      const canvas = await renderHarness();

      await pointer(canvas, 'pointerdown', grab);
      await pointer(canvas, 'pointermove', plus(grab, { x: 4, y: -3 }));
      expectSelectedDisplacement({ x: 4, y: -3 }, canonical);
      await pointer(canvas, 'pointermove', plus(grab, { x: -2, y: 6 }));
      expectSelectedDisplacement({ x: -2, y: 6 }, canonical);
      expect(useStore.getState().selectedPathNodes).toEqual(selection);
      expect(useStore.getState().selectedPathNode).toEqual(primary);
      expect(useStore.getState().undoStack).toHaveLength(0);
      await pointer(canvas, 'pointerup', plus(grab, { x: -2, y: 6 }));
      expect(useStore.getState().undoStack).toEqual([original]);
      const moved = useStore.getState().project;
      await act(async () => useStore.getState().undo());
      expect(useStore.getState().project).toEqual(original);
      await act(async () => useStore.getState().redo());
      expect(useStore.getState().project).toEqual(moved);
    },
  );

  it('uses scene displacement for a rotated, mirrored and nonuniformly scaled object', async () => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      x: 200,
      y: 40,
      scaleX: 1.5,
      scaleY: 0.5,
      mirrorX: true,
      rotationDeg: 90,
    };
    loadPaths(true, transform);
    selectPair(true);
    const before = [0, 1, 2].map((index) => sceneNode(ref(index, true)));
    const grab = plus(before[0]!, { x: 0.75, y: -0.75 });
    const canvas = await renderHarness();
    await pointer(canvas, 'pointerdown', grab);
    await pointer(canvas, 'pointermove', plus(grab, { x: 4, y: -3 }));
    for (const index of [0, 1, 2]) {
      expectPoint(
        sceneNode(ref(index, true)),
        plus(before[index]!, index < 2 ? { x: 4, y: -3 } : { x: 0, y: 0 }),
      );
    }
    await pointer(canvas, 'pointerup', grab);
  });

  it('Shift-adds an unselected node, then drags the entire resulting set', async () => {
    loadPaths();
    useStore.getState().selectPathNode(ref(0));
    const canvas = await renderHarness();
    await pointer(canvas, 'pointerdown', { x: 80.75, y: 40.5 }, { shiftKey: true });
    await pointer(canvas, 'pointermove', { x: 84.75, y: 37.5 }, { shiftKey: true });
    expectSelectedDisplacement({ x: 4, y: -3 });
    expect(useStore.getState().selectedPathNodes).toEqual([ref(0), ref(1)]);
    await pointer(canvas, 'pointerup', { x: 84.75, y: 37.5 });
  });

  it.each([0, 1])(
    'Shift-removes selected node %i without dragging the remaining selection',
    async (pointIndex) => {
      loadPaths();
      selectPair();
      const original = useStore.getState().project;
      const canvas = await renderHarness();
      const grab = POINTS[pointIndex]!;
      await pointer(canvas, 'pointerdown', grab, { shiftKey: true });
      await pointer(canvas, 'pointermove', plus(grab, { x: 4, y: -3 }), { shiftKey: true });
      await pointer(canvas, 'pointerup', grab);
      expect(useStore.getState().selectedPathNodes).toEqual([ref(1 - pointIndex)]);
      expect(useStore.getState().project).toBe(original);
      expect(useStore.getState().pendingUndo).toBeNull();
      expect(useStore.getState().undoStack).toHaveLength(0);
    },
  );

  it.each([false, true])(
    'selects only the other object when grabbing its node (Shift=$0)',
    async (shiftKey) => {
      loadPaths();
      selectPair();
      const project = useStore.getState().project;
      useStore.setState({
        project: {
          ...project,
          scene: addObject(
            project.scene,
            pathObject('other', false, { ...IDENTITY_TRANSFORM, x: 120 }),
          ),
        },
      });
      const canvas = await renderHarness();
      await pointer(canvas, 'pointerdown', { x: 160.75, y: 40.5 }, { shiftKey });
      await pointer(canvas, 'pointermove', { x: 164.75, y: 37.5 });
      expectPoint(sceneNode({ ...ref(0), objectId: 'other' }), { x: 164, y: 37 });
      expectSelectedDisplacement({ x: 0, y: 0 });
      expect(useStore.getState().selectedPathNodes).toEqual([{ ...ref(0), objectId: 'other' }]);
      await pointer(canvas, 'pointerup', { x: 164.75, y: 37.5 });
    },
  );

  it.each(['Escape', 'pointercancel', 'lostpointercapture'] as const)(
    'restores geometry and selection on %s, with no Undo entry',
    async (cancel) => {
      loadPaths();
      selectPair();
      const original = useStore.getState().project;
      const canvas = await renderHarness();
      await pointer(canvas, 'pointerdown', { x: 40.75, y: 40.5 });
      await pointer(canvas, 'pointermove', { x: 44.75, y: 37.5 });
      expectSelectedDisplacement({ x: 4, y: -3 });
      if (cancel === 'Escape') {
        await act(async () =>
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        );
      } else {
        await pointer(canvas, cancel, { x: 44.75, y: 37.5 });
      }
      expect(useStore.getState().project).toBe(original);
      expect(useStore.getState().selectedPathNodes).toEqual([ref(0), ref(1)]);
      expect(useStore.getState().selectedPathNode).toEqual(ref(1));
      expect(useStore.getState().undoStack).toHaveLength(0);
      expect(useStore.getState().pendingUndo).toBeNull();
      expect(useStore.getState().dirty).toBe(false);
      await pointer(canvas, 'pointermove', { x: 60, y: 60 });
      await pointer(canvas, 'pointerup', { x: 60, y: 60 });
      expect(useStore.getState().project).toBe(original);
    },
  );

  it('snaps the grabbed node onto the marker despite its grab offset, and Alt restores free displacement', async () => {
    loadPaths();
    selectPair();
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        scene: addObject(
          project.scene,
          pathObject('target', false, { ...IDENTITY_TRANSFORM, x: 100, y: 80 }),
        ),
      },
    });
    useUiStore.setState({ snapSettings: { ...DEFAULT_SNAP_SETTINGS, snapToGrid: false } });
    const canvas = await renderHarness();
    await pointer(canvas, 'pointerdown', { x: 40.75, y: 40.5 });
    await pointer(canvas, 'pointermove', { x: 141.25, y: 120.75 });
    expect(useUiStore.getState().snapMarker).toEqual({ kind: 'node', pointMm: { x: 140, y: 120 } });
    expectSelectedDisplacement({ x: 100, y: 80 });
    await pointer(canvas, 'pointermove', { x: 141.25, y: 120.75 }, { altKey: true });
    expect(useUiStore.getState().snapMarker).toBeNull();
    expectSelectedDisplacement({ x: 100.5, y: 80.25 });
    await pointer(canvas, 'pointerup', { x: 141.25, y: 120.75 });
  });
});

function ref(pointIndex: number, canonical = false): PathNodeRef {
  return {
    objectId: 'path',
    pathIndex: 0,
    polylineIndex: 0,
    pointIndex,
    ...(canonical ? { geometry: 'curve' as const } : {}),
  };
}

function selectPair(canonical = false): void {
  useStore.getState().selectPathNode(ref(0, canonical));
  useStore.getState().selectPathNode(ref(1, canonical), { additive: true });
}

function loadPaths(canonical = false, transform: Transform = IDENTITY_TRANSFORM): void {
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      scene: addObject(project.scene, pathObject('path', canonical, transform)),
    },
  });
}

function pathObject(id: string, canonical: boolean, transform: Transform): ImportedSvg {
  const polyline = { closed: false, points: POINTS };
  return {
    kind: 'imported-svg',
    id,
    source: 'nodes.svg',
    transform,
    bounds: { minX: 40, minY: 40, maxX: 80, maxY: 80 },
    paths: [
      {
        color: '#000000',
        polylines: [polyline],
        ...(canonical ? { curves: [polylineToCurveSubpath(polyline)] } : {}),
      },
    ],
  };
}

function sceneNode(node: PathNodeRef): Vec2 {
  const object = useStore
    .getState()
    .project.scene.objects.find((candidate) => candidate.id === node.objectId) as ImportedSvg;
  const point = pathNodePoint(object.paths, node);
  if (point === null) throw new Error('missing node');
  return applyTransform(point, object.transform);
}

function expectSelectedDisplacement(delta: Vec2, canonical = false): void {
  for (const index of [0, 1, 2]) {
    expectPoint(
      sceneNode(ref(index, canonical)),
      plus(POINTS[index]!, index < 2 ? delta : { x: 0, y: 0 }),
    );
  }
}

function expectPoint(actual: Vec2, expected: Vec2): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

function plus(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
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

async function renderHarness(): Promise<HTMLCanvasElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<DragHarness />));
  const canvas = host.querySelector('canvas');
  if (canvas === null) throw new Error('canvas missing');
  return canvas;
}

async function pointer(
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  point: Vec2,
  modifiers: { readonly shiftKey?: boolean; readonly altKey?: boolean } = {},
): Promise<void> {
  const device = useStore.getState().project.device;
  const view = computeView(CANVAS_SIZE, CANVAS_SIZE, device.bedWidth, device.bedHeight, VIEW);
  // jsdom has no PointerEvent; React reads the pointerId from this MouseEvent.
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
