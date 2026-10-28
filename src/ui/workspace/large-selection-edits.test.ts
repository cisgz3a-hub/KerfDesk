import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { applyTransformDrag } from './apply-transform-drag';
import { CANVAS_PADDING_PX } from './canvas-layout';
import { computeMouseDownDrag, type DragState } from './drag-state';
import { DEFAULT_SNAP_SETTINGS } from './snapping';

// Rolling audit v5 J10-P2-1: editing a large selection cost O(selected ×
// objects) on the UI thread, about 2 s per drag frame at 8,000 objects, and
// Abort waits behind a frame during a job. These pins count work instead of
// timing it, so they cannot flake on a slow runner:
// - a drag frame is one store write for the whole selection;
// - an edit reads each object's id a bounded number of times, where a scan of
//   the scene per selected id reads it about objects / 2 times.
const DRAG_OBJECTS = 4_000;
const LOOKUP_OBJECTS = 2_000;
// The fixed paths read each id 1 to 6 times (id maps, the one-pass scene
// map, cloning). A scan of the scene per selected id reads it ~1,000 times.
const ID_READS_PER_OBJECT_BUDGET = 20;

const event = { shiftKey: false, ctrlKey: false, metaKey: false };
const snapSettings = { ...DEFAULT_SNAP_SETTINGS, snapToGrid: false };

let idReads = 0;

describe('large selection edits (J10-P2-1)', () => {
  beforeEach(() => {
    resetStore();
    idReads = 0;
  });

  it('moves 4,000 selected objects with one store write per drag frame and one Undo step', () => {
    const objects = gridObjects(DRAG_OBJECTS);
    loadAndSelectAll(objects);
    const writes = countStoreWrites();
    useStore.getState().beginInteraction();
    const drag = moveDrag(objects);

    writes.reset();
    dragTo(drag, { x: 3, y: 2 });
    expect(writes.count()).toBe(1);
    dragTo(drag, { x: 7, y: -1 });
    expect(writes.count()).toBe(2);
    useStore.getState().endInteraction();

    const state = useStore.getState();
    expect(state.undoStack).toHaveLength(1);
    expect(state.project.scene.objects.map((object) => object.transform.x)).toEqual(
      objects.map((object) => object.transform.x + 7),
    );
    expect(state.project.scene.objects.map((object) => object.transform.y)).toEqual(
      objects.map((object) => object.transform.y - 1),
    );
    writes.stop();
  });

  it('scales and rotates 4,000 selected objects with one store write per drag frame', () => {
    const objects = gridObjects(DRAG_OBJECTS);
    loadAndSelectAll(objects);
    const writes = countStoreWrites();
    const ids = objects.map((object) => object.id);
    useStore.getState().beginInteraction();

    writes.reset();
    dragTo({ kind: 'selection-scale', handle: 'se', selectionIds: ids }, { x: 600, y: 600 });
    expect(writes.count()).toBe(1);

    writes.reset();
    dragTo(
      {
        kind: 'rotate',
        objectId: ids[0] ?? '',
        selectionStartTransforms: objects.map(({ id, transform }) => ({ id, transform })),
        rotateAnchor: { x: 100, y: 100 },
        startPointerAngleDeg: 0,
      },
      { x: 100, y: 200 },
    );
    expect(writes.count()).toBe(1);
    useStore.getState().endInteraction();

    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().project.scene.objects[0]?.transform.rotationDeg).toBeCloseTo(90);
    writes.stop();
  });

  it('finds the selected objects of a mouse-down without a scene scan per id', () => {
    const objects = gridObjects(LOOKUP_OBJECTS);
    const project = projectWithObjects(objects);
    const [first, ...rest] = objects.map((object) => object.id);
    idReads = 0;

    const drag = computeMouseDownDrag({
      e: mouseEventAtScenePoint({ x: 102, y: 102 }),
      ref: canvasRef(),
      project,
      selectedObjectId: first ?? null,
      additionalSelectedIds: new Set(rest),
      viewState: { zoomFactor: 1, panX: 0, panY: 0 },
      onShiftClick: vi.fn(),
      onPlainClick: vi.fn(),
    });

    expect(drag).toMatchObject({ kind: 'move' });
    expect(drag?.kind === 'move' ? drag.selectionStartTransforms : []).toHaveLength(LOOKUP_OBJECTS);
    expectBoundedIdReads();
  });

  it('nudges, undoes and redoes a whole selection without a scene scan per id', () => {
    const objects = gridObjects(LOOKUP_OBJECTS);
    loadAndSelectAll(objects);

    idReads = 0;
    useStore.getState().nudgeSelection(1, 0);
    expectBoundedIdReads();
    expect(useStore.getState().project.scene.objects[0]?.transform.x).toBe(1);

    idReads = 0;
    useStore.getState().undo();
    expectBoundedIdReads();
    expect(useStore.getState().additionalSelectedIds.size).toBe(LOOKUP_OBJECTS - 1);

    useStore.getState().redo();
    idReads = 0;
    useStore.getState().undo();
    expectBoundedIdReads();
  });

  it('duplicates a whole selection without a scene scan per id', () => {
    const objects = gridObjects(LOOKUP_OBJECTS);
    loadAndSelectAll(objects);

    idReads = 0;
    useStore.getState().duplicateSelection();

    expectBoundedIdReads();
    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(LOOKUP_OBJECTS * 2);
    expect(state.additionalSelectedIds.size).toBe(LOOKUP_OBJECTS - 1);
    expect(state.undoStack).toHaveLength(1);
  });
});

function expectBoundedIdReads(): void {
  expect(idReads).toBeLessThanOrEqual(LOOKUP_OBJECTS * ID_READS_PER_OBJECT_BUDGET);
}

function dragTo(drag: DragState, point: { readonly x: number; readonly y: number }): void {
  const state = useStore.getState();
  applyTransformDrag({
    drag,
    point,
    e: event,
    project: state.project,
    selectionAnchor: 'c',
    snapSettings,
    pxToMm: 0.25,
    setObjectTransforms: state.setObjectTransforms,
    setSnapGuides: () => undefined,
    setSnapMarker: () => undefined,
  });
}

function moveDrag(objects: ReadonlyArray<SceneObject>): Extract<DragState, { kind: 'move' }> {
  const first = objects[0];
  if (first === undefined) throw new Error('no objects');
  return {
    kind: 'move',
    objectId: first.id,
    startScenePoint: { x: 0, y: 0 },
    startTx: first.transform.x,
    startTy: first.transform.y,
    selectionStartTransforms: objects.map(({ id, transform }) => ({ id, transform })),
  };
}

function countStoreWrites(): {
  readonly count: () => number;
  readonly reset: () => void;
  readonly stop: () => void;
} {
  let writes = 0;
  const stop = useStore.subscribe(() => {
    writes += 1;
  });
  return { count: () => writes, reset: () => (writes = 0), stop };
}

function loadAndSelectAll(objects: ReadonlyArray<SceneObject>): void {
  useStore.setState({ project: projectWithObjects(objects) });
  useStore.getState().selectAllObjects();
  expect(useStore.getState().additionalSelectedIds.size).toBe(objects.length - 1);
}

function projectWithObjects(objects: ReadonlyArray<SceneObject>): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects } };
}

// Unlocked 4 mm squares on a 5 mm grid, each counting reads of its id. A copy
// made by spread or structuredClone reads the id once and keeps a plain value.
function gridObjects(count: number): SceneObject[] {
  return Array.from({ length: count }, (_, index) => {
    const object: SceneObject = {
      kind: 'imported-svg',
      id: '',
      source: 'grid.svg',
      bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
      transform: { ...IDENTITY_TRANSFORM, x: (index % 50) * 5, y: Math.floor(index / 50) * 5 },
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 4 },
                { x: 0, y: 4 },
              ],
            },
          ],
        },
      ],
    };
    const id = `grid-${index}`;
    Object.defineProperty(object, 'id', {
      enumerable: true,
      get: () => {
        idReads += 1;
        return id;
      },
    });
    return object;
  });
}

const CANVAS_SIZE = 400 + CANVAS_PADDING_PX * 2;

function canvasRef(): React.RefObject<HTMLCanvasElement> {
  return {
    current: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_SIZE, height: CANVAS_SIZE }),
    } as HTMLCanvasElement,
  };
}

function mouseEventAtScenePoint(point: {
  readonly x: number;
  readonly y: number;
}): React.MouseEvent<HTMLCanvasElement> {
  return {
    button: 0,
    clientX: CANVAS_PADDING_PX + point.x,
    clientY: CANVAS_PADDING_PX + point.y,
    shiftKey: false,
    altKey: false,
  } as React.MouseEvent<HTMLCanvasElement>;
}
