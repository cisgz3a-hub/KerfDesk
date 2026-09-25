import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addObject,
  createLayer,
  createProject,
  curveNodePoint,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { pointOnSegment } from '../../core/geometry/curve-segment-geometry';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useNodeEditStore } from './node-edit-store';
import {
  beginPathNodeDrag,
  finishPathNodeDrag,
  updatePathNodeDrag,
  type PathNodeDragModifiers,
  type PathNodeDragState,
} from './path-node-drag';
import { DEFAULT_SNAP_SETTINGS, type SnapGuide, type SnapSettings } from './snapping';

const PX_TO_MM = 0.1;
const NO_KEYS: PathNodeDragModifiers = {
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
};
const SNAP_OFF: SnapSettings = { ...DEFAULT_SNAP_SETTINGS, enabled: false };

describe('beginPathNodeDrag', () => {
  beforeEach(() => useNodeEditStore.setState({ selectedSegment: null, feedback: null }));

  it('selects the hit node and remembers where it started', () => {
    const selectPathNode = vi.fn();
    const project = {
      ...createProject(),
      scene: addObject(EMPTY_SCENE, vectorObject()),
    };

    const drag = beginPathNodeDrag({
      project,
      scenePoint: { x: 10.25, y: 0.2 },
      pxToMm: 0.25,
      selectedPathNodes: [],
      selectPathNode,
    });

    const ref = { objectId: 'logo', pathIndex: 0, polylineIndex: 0, pointIndex: 1 };
    expect(drag).toEqual({
      kind: 'path-node',
      startScenePoint: { x: 10.25, y: 0.2 },
      grab: { kind: 'node', ref, origin: { x: 10, y: 0 } },
    });
    expect(selectPathNode).toHaveBeenCalledWith(ref, { additive: false });
  });

  it('passes additive selection through for Shift-click node selection', () => {
    const selectPathNode = vi.fn();
    const project = {
      ...createProject(),
      scene: addObject(EMPTY_SCENE, vectorObject()),
    };

    beginPathNodeDrag({
      project,
      scenePoint: { x: 10.25, y: 0.2 },
      pxToMm: 0.25,
      additive: true,
      selectedPathNodes: [],
      selectPathNode,
    });

    expect(selectPathNode).toHaveBeenCalledWith(
      {
        objectId: 'logo',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex: 1,
      },
      {
        additive: true,
      },
    );
  });

  it('keeps the multi-node selection when plain-clicking an already-selected node (C6)', () => {
    const selectPathNode = vi.fn();
    const project = { ...createProject(), scene: addObject(EMPTY_SCENE, vectorObject()) };
    const hitRef = { objectId: 'logo', pathIndex: 0, polylineIndex: 0, pointIndex: 1 };

    const drag = beginPathNodeDrag({
      project,
      scenePoint: { x: 10.25, y: 0.2 },
      pxToMm: 0.25,
      selectedPathNodes: [
        hitRef,
        { objectId: 'logo', pathIndex: 0, polylineIndex: 0, pointIndex: 0 },
      ],
      selectPathNode,
    });

    expect(drag).toMatchObject({ kind: 'path-node' });
    // The set is preserved for the drag — no re-select that would collapse it.
    expect(selectPathNode).not.toHaveBeenCalled();
  });

  it('clears node selection and does not start a drag when no node is hit', () => {
    const selectPathNode = vi.fn();
    const project = {
      ...createProject(),
      scene: addObject(EMPTY_SCENE, vectorObject()),
    };

    expect(
      beginPathNodeDrag({
        project,
        scenePoint: { x: 100, y: 100 },
        pxToMm: 0.25,
        selectedPathNodes: [],
        selectPathNode,
      }),
    ).toBeNull();
    expect(selectPathNode).toHaveBeenCalledWith(null);
  });

  it('grabs a point on a segment of the artwork being edited', () => {
    const selectPathNode = vi.fn();
    const project = { ...createProject(), scene: addObject(EMPTY_SCENE, vectorObject()) };

    const drag = beginPathNodeDrag({
      project,
      scenePoint: { x: 4, y: 0.3 },
      pxToMm: PX_TO_MM,
      selectedObjectId: 'logo',
      selectedPathNodes: [],
      selectPathNode,
    });

    const ref = { objectId: 'logo', pathIndex: 0, polylineIndex: 0, segmentIndex: 0 };
    expect(drag?.grab).toMatchObject({ kind: 'segment', ref, origin: { x: 4, y: 0 } });
    expect(drag?.grab.kind === 'segment' ? drag.grab.t : null).toBeCloseTo(0.4, 6);
    expect(selectPathNode).toHaveBeenCalledWith(null);
    expect(useNodeEditStore.getState().selectedSegment?.ref).toEqual(ref);
  });

  it('picks other artwork under the pointer to edit next', () => {
    const selectObject = vi.fn();
    const other = { ...vectorObject(), id: 'other', transform: { ...IDENTITY_TRANSFORM, y: 50 } };
    const project = {
      ...createProject(),
      scene: addObject(addObject(EMPTY_SCENE, vectorObject()), other),
    };

    const drag = beginPathNodeDrag({
      project,
      scenePoint: { x: 5, y: 50.5 },
      pxToMm: PX_TO_MM,
      selectedObjectId: 'logo',
      selectedPathNodes: [],
      selectPathNode: vi.fn(),
      selectObject,
    });

    expect(drag).toBeNull();
    expect(selectObject).toHaveBeenCalledWith('other');
  });
});

describe('node tool drags', () => {
  let guides: ReadonlyArray<SnapGuide> = [];

  beforeEach(() => {
    resetStore();
    guides = [];
    useNodeEditStore.setState({ selectedSegment: null, feedback: null });
  });

  it('moves the grabbed node by the pointer travel instead of jumping onto the pointer', () => {
    load([artwork('art', [line([0, 10, 20])])]);
    const drag = press({ x: 10.3, y: 0.2 });

    move(drag, { x: 12.3, y: 3.2 });

    expectNode('art', 1, { x: 12, y: 3 });
  });

  it('bends a clicked segment only once the pointer has really moved', () => {
    const project = load([artwork('art', [line([0, 10, 20])])]);
    const drag = press({ x: 5, y: 0.1 });
    expect(useStore.getState().selectedPathNodes).toEqual([]);
    expect(useNodeEditStore.getState().selectedSegment?.ref.segmentIndex).toBe(0);

    move(drag, { x: 5.1, y: 0.2 });
    expect(useStore.getState().project).toBe(project);
    move(drag, { x: 5, y: 3.1 });
    release(drag);

    const curve = curveOf('art');
    const bent = curve.segments[0];
    expect(bent?.kind).toBe('cubic');
    const middle = pointOnSegment(curve.start, bent!, 0.5);
    expect(middle.x).toBeCloseTo(5, 9);
    expect(middle.y).toBeCloseTo(3, 9);
    expect(useStore.getState().undoStack).toEqual([project]);
  });

  it('keeps a Shift drag on the nearest 45° line from where the node started', () => {
    load([artwork('art', [line([0, 10, 20])])]);
    const drag = press({ x: 10, y: 0 });

    move(drag, { x: 13, y: 2.5 }, { shiftKey: true });

    const node = curveNodePoint(curveOf('art'), 1);
    expect(node?.x).toBeCloseTo(12.75, 9);
    expect(node?.y).toBeCloseTo(2.75, 9);
    expect(useNodeEditStore.getState().feedback?.constraint?.from).toEqual({ x: 10, y: 0 });
  });

  it('snaps a dragged node to other nodes, midpoints and the grid unless Ctrl is held', () => {
    load([artwork('art', [line([0, 10, 20])]), artwork('other', [line([30, 40], 5)])]);
    const drag = press({ x: 20, y: 0 });
    const snap = { ...DEFAULT_SNAP_SETTINGS, gridMm: 10, distanceMm: 2 };

    move(drag, { x: 29.2, y: 4.4 }, {}, snap);
    expectNode('art', 2, { x: 30, y: 5 });
    expect(useNodeEditStore.getState().feedback?.snapPoint).toEqual({ x: 30, y: 5 });

    move(drag, { x: 35.5, y: 5.5 }, {}, snap);
    expectNode('art', 2, { x: 35, y: 5 });

    move(drag, { x: 41.5, y: 8.7 }, {}, snap);
    expectNode('art', 2, { x: 40, y: 10 });
    expect(guides.map((guide) => [guide.axis, guide.positionMm])).toEqual([
      ['x', 40],
      ['y', 10],
    ]);

    move(drag, { x: 29.2, y: 4.4 }, { ctrlKey: true }, snap);
    expectNode('art', 2, { x: 29.2, y: 4.4 });
  });

  it('never snaps a node to itself or to the segments it drags along', () => {
    load([artwork('art', [line([0, 10, 20])])]);
    const drag = press({ x: 10, y: 0 });
    const snap = { ...DEFAULT_SNAP_SETTINGS, snapToGrid: false };

    move(drag, { x: 5.5, y: 0.5 }, {}, snap);

    expectNode('art', 1, { x: 5.5, y: 0.5 });
    expect(useNodeEditStore.getState().feedback?.snapPoint).toBeNull();
  });

  it('joins an open end dropped on another open end, all in one undo step', () => {
    const project = load([artwork('art', [line([0, 10]), line([12, 20])])]);
    const drag = press({ x: 10, y: 0 });

    move(drag, { x: 11.9, y: 0.1 });
    expect(useNodeEditStore.getState().feedback?.join?.point).toEqual({ x: 12, y: 0 });
    expect(curveNodePoint(curveOf('art'), 1)).toEqual({ x: 12, y: 0 });
    release(drag);

    const object = objectOf('art');
    const curves = 'paths' in object ? object.paths[0]?.curves : undefined;
    expect(curves).toHaveLength(1);
    expect(curves?.[0]?.segments.map((segment) => segment.to)).toEqual([
      { x: 12, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(useStore.getState().undoStack).toEqual([project]);
    expect(useNodeEditStore.getState().feedback).toBeNull();
  });

  function press(point: Vec2): PathNodeDragState {
    const app = useStore.getState();
    const drag = beginPathNodeDrag({
      project: app.project,
      scenePoint: point,
      pxToMm: PX_TO_MM,
      selectedObjectId: app.selectedObjectId,
      additionalSelectedIds: app.additionalSelectedIds,
      selectedPathNodes: app.selectedPathNodes,
      selectPathNode: app.selectPathNode,
      selectObject: app.selectObject,
    });
    if (drag === null) throw new Error('nothing grabbed');
    useStore.getState().beginInteraction();
    return drag;
  }

  function move(
    drag: PathNodeDragState,
    point: Vec2,
    modifiers: Partial<PathNodeDragModifiers> = {},
    snapSettings: SnapSettings = SNAP_OFF,
  ): void {
    updatePathNodeDrag({
      drag,
      point,
      modifiers: { ...NO_KEYS, ...modifiers },
      pxToMm: PX_TO_MM,
      snapSettings,
      setSnapGuides: (next) => {
        guides = next;
      },
    });
  }
});

function expectNode(id: string, index: number, expected: Vec2): void {
  const node = curveNodePoint(curveOf(id), index);
  expect(node?.x).toBeCloseTo(expected.x, 9);
  expect(node?.y).toBeCloseTo(expected.y, 9);
}

function release(drag: PathNodeDragState): void {
  finishPathNodeDrag(drag);
  useStore.getState().endInteraction();
}

function load(objects: ReadonlyArray<SceneObject>): Project {
  const project: Project = {
    ...createProject(),
    scene: {
      objects,
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [],
    },
  };
  useStore.setState({ project, selectedObjectId: objects[0]?.id ?? null });
  return project;
}

function objectOf(id: string): SceneObject {
  const object = useStore.getState().project.scene.objects.find((candidate) => candidate.id === id);
  if (object === undefined) throw new Error(`missing ${id}`);
  return object;
}

function curveOf(id: string): CurveSubpath {
  const object = objectOf(id);
  const curve = 'paths' in object ? object.paths[0]?.curves?.[0] : undefined;
  if (curve === undefined) throw new Error(`missing curve on ${id}`);
  return curve;
}

function line(xs: ReadonlyArray<number>, y = 0): CurveSubpath {
  return {
    start: { x: xs[0] ?? 0, y },
    segments: xs.slice(1).map((x) => ({ kind: 'line' as const, to: { x, y } })),
    closed: false,
  };
}

function artwork(id: string, curves: ReadonlyArray<CurveSubpath>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: curves.map((curve) => ({
          points: [curve.start, ...curve.segments.map((segment) => segment.to)],
          closed: curve.closed,
        })),
        curves,
      },
    ],
  };
}

function vectorObject(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'logo',
    source: 'logo.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}
