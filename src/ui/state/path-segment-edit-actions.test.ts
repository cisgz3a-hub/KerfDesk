import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  curveNodeCount,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import { deserializeProject, serializeProject } from '../../io/project';
import { materializedPolylineToSpecPoints } from './path-node-edit-geometry';
import { resetStore } from './test-helpers';
import { useStore } from './store';

const PEN_POINTS: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('node editor segment commands', () => {
  beforeEach(() => resetStore());

  it('inserts a node on a segment as one undo step and selects it', () => {
    load([curveObject('art', [openLine(0, 30)])]);
    const before = useStore.getState().project;

    expect(useStore.getState().insertPathNode(segment('art', 0), 0.5)).toBe(true);

    const curve = curveOf('art');
    expect(curve.segments.map((entry) => entry.to)).toEqual([
      { x: 15, y: 0 },
      { x: 30, y: 0 },
    ]);
    expectOneUndoStepFrom(before);
    expect(useStore.getState().selectedPathNode).toEqual({
      objectId: 'art',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 1,
      geometry: 'curve',
    });
  });

  it('promotes a legacy polyline path when a node is inserted', () => {
    const legacy: ImportedSvg = {
      ...curveObject('art', []),
      paths: [
        {
          color: '#000000',
          polylines: [{ points: PEN_POINTS, closed: true }],
        },
      ],
    };
    load([legacy]);

    // Edge 3 is the closing edge from (0,10) back to (0,0).
    useStore.getState().insertPathNodeAtMidpoint(segment('art', 3));

    const curve = curveOf('art');
    expect(curve.closed).toBe(true);
    expect(curveNodeCount(curve)).toBe(5);
    expect(curve.segments.at(-2)?.to).toEqual({ x: 0, y: 5 });
    expect(pathsOf('art')[0]?.polylines[0]?.points).toContainEqual({ x: 0, y: 5 });
  });

  it('keeps a pen drawing in step when a node is inserted', () => {
    load([pen('pen', true)]);
    useStore.getState().insertPathNode(segment('pen', 1), 0.25);
    expectPenInStep('pen');
    const shape = objectOf('pen');
    if (shape.kind !== 'shape' || shape.spec.kind !== 'polyline') throw new Error('pen');
    expect(shape.spec.points).toHaveLength(5);
    expect(shape.spec.points[2]).toEqual({ x: 10, y: 2.5 });
  });

  it('opens a closed path where a segment is deleted', () => {
    load([pen('pen', true)]);
    const before = useStore.getState().project;

    expect(useStore.getState().deletePathSegment(segment('pen', 0))).toBe('deleted');

    const shape = objectOf('pen');
    expect(shape.kind).toBe('shape');
    expectPenInStep('pen');
    if (shape.kind !== 'shape' || shape.spec.kind !== 'polyline') throw new Error('pen');
    expect(shape.spec.closed).toBe(false);
    expect(shape.spec.points).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]);
    expectOneUndoStepFrom(before);
  });

  it('turns a pen drawing split in two into a path object with the same placement', () => {
    const drawing = { ...pen('pen', false), transform: { ...IDENTITY_TRANSFORM, x: 5, y: 7 } };
    load([drawing]);
    const original = curveOf('pen');

    expect(useStore.getState().deletePathSegment(segment('pen', 1))).toBe('deleted');

    const object = objectOf('pen');
    expect(object.kind).toBe('imported-svg');
    expect(object.transform).toEqual(drawing.transform);
    const curves = object.kind === 'imported-svg' ? object.paths[0]?.curves : undefined;
    expect(curves).toHaveLength(2);
    expect(curves?.[0]?.segments).toEqual(original.segments.slice(0, 1));
    expect(curves?.[1]?.start).toEqual(original.segments[1]?.to);

    useStore.getState().undo();
    expect(objectOf('pen')).toBe(drawing);
  });

  it('reports the last segment of the artwork instead of emptying it', () => {
    load([curveObject('art', [openLine(0, 10)])]);
    const before = useStore.getState().project;
    expect(useStore.getState().deletePathSegment(segment('art', 0))).toBe('last-segment');
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toEqual([]);
  });

  it('breaks a closed pen drawing open at a node without losing a segment', () => {
    load([pen('pen', true)]);
    const before = useStore.getState().project;

    expect(useStore.getState().breakPathAtNode(node('pen', 2))).toBe(true);

    expectPenInStep('pen');
    const shape = objectOf('pen');
    if (shape.kind !== 'shape' || shape.spec.kind !== 'polyline') throw new Error('pen');
    expect(shape.spec.closed).toBe(false);
    expect(shape.spec.points[0]).toEqual({ x: 10, y: 10 });
    expect(shape.spec.points.at(-1)).toEqual({ x: 10, y: 10 });
    expect(shape.spec.points).toHaveLength(5);
    expectOneUndoStepFrom(before);
  });

  it('breaks an open path at an interior node into two paths of the same object', () => {
    load([curveObject('art', [openPolyline(PEN_POINTS)])]);
    expect(useStore.getState().breakPathAtNode(node('art', 1))).toBe(true);
    const curves = pathsOf('art')[0]?.curves ?? [];
    expect(curves).toHaveLength(2);
    expect(curves[0]?.segments.at(-1)?.to).toEqual({ x: 10, y: 0 });
    expect(curves[1]?.start).toEqual({ x: 10, y: 0 });
    expect(useStore.getState().breakPathAtNode(node('art', 0))).toBe(false);
  });

  it('converts a segment to a curve and back to a line', () => {
    load([pen('pen', true)]);
    const before = useStore.getState().project;
    expect(useStore.getState().convertPathSegment(segment('pen', 1), 'cubic')).toBe(true);
    expect(curveOf('pen').segments[1]?.kind).toBe('cubic');
    expectPenInStep('pen');
    expectOneUndoStepFrom(before);

    expect(useStore.getState().convertPathSegment(segment('pen', 1), 'cubic')).toBe(false);
    expect(useStore.getState().convertPathSegment(segment('pen', 1), 'line')).toBe(true);
    expect(curveOf('pen').segments[1]).toEqual({ kind: 'line', to: { x: 10, y: 10 } });
  });

  it('toggles a node between smooth and corner', () => {
    load([pen('pen', true)]);
    expect(useStore.getState().setPathNodeSmoothness(node('pen', 1), 'toggle')).toBe(true);
    const smoothed = curveOf('pen');
    expect(smoothed.segments.slice(0, 2).map((entry) => entry.kind)).toEqual(['cubic', 'cubic']);
    expectPenInStep('pen');
    expect(useStore.getState().selectedPathNode).toMatchObject({ pointIndex: 1 });

    expect(useStore.getState().setPathNodeSmoothness(node('pen', 1), 'toggle')).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(2);
    // Corner on a node that is already a corner changes nothing.
    expect(useStore.getState().setPathNodeSmoothness(node('pen', 1), 'corner')).toBe(false);
  });

  it('trims a line back to where it crosses other artwork', () => {
    const post = curveObject('post', [openLine(0, 20)], { x: 10, y: -10, rotationDeg: 90 });
    load([curveObject('art', [openLine(0, 30)]), post]);
    const before = useStore.getState().project;

    expect(useStore.getState().trimPathSegment(segment('art', 0), 0.1)).toBe('trimmed');

    const curve = curveOf('art');
    expect(curve.start.x).toBeCloseTo(10, 6);
    expect(curve.segments.at(-1)?.to).toEqual({ x: 30, y: 0 });
    expectOneUndoStepFrom(before);

    expect(useStore.getState().trimPathSegment(segment('art', 0), 0.9)).toBe('no-crossing');
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('survives save and reopen after a topology edit', () => {
    load([pen('pen', false)]);
    useStore.getState().deletePathSegment(segment('pen', 1));
    const reopened = deserializeProject(serializeProject(useStore.getState().project));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') return;
    expect(reopened.project.scene.objects[0]?.kind).toBe('imported-svg');
  });
});

describe('node editor alignment', () => {
  beforeEach(() => resetStore());

  it('lines selected nodes up on the node selected last, as one undo step', () => {
    load([
      curveObject('art', [
        openPolyline([
          { x: 0, y: 1 },
          { x: 10, y: -1 },
          { x: 20, y: 3 },
        ]),
      ]),
    ]);
    useStore.getState().selectPathNode(node('art', 0));
    useStore.getState().selectPathNode(node('art', 1), { additive: true });
    useStore.getState().selectPathNode(node('art', 2), { additive: true });
    const before = useStore.getState().project;

    expect(useStore.getState().alignSelectedPathNodes()).toBe(true);

    const curve = curveOf('art');
    expect([curve.start, ...curve.segments.map((entry) => entry.to)]).toEqual([
      { x: 0, y: 3 },
      { x: 10, y: 3 },
      { x: 20, y: 3 },
    ]);
    expect(useStore.getState().selectedPathNodes).toHaveLength(3);
    expectOneUndoStepFrom(before);
  });

  it('turns the artwork so the segment lies on the nearest 45 degree line', () => {
    load([
      curveObject('art', [
        openPolyline([
          { x: 0, y: 0 },
          { x: 10, y: 1 },
        ]),
      ]),
    ]);
    expect(useStore.getState().alignPathSegmentAngle(segment('art', 0))).toBe(true);
    const object = objectOf('art');
    expect(object.transform.rotationDeg).toBeCloseTo(360 - (Math.atan2(1, 10) * 180) / Math.PI, 6);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});

function load(objects: ReadonlyArray<SceneObject>): void {
  const project: Project = {
    ...createProject(),
    scene: {
      objects,
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [],
    },
  };
  useStore.setState({ project, selectedObjectId: objects[0]?.id ?? null });
}

function objectOf(id: string): SceneObject {
  const object = useStore.getState().project.scene.objects.find((candidate) => candidate.id === id);
  if (object === undefined) throw new Error(`missing ${id}`);
  return object;
}

function pathsOf(id: string): ReadonlyArray<ColoredPath> {
  const object = objectOf(id);
  return 'paths' in object ? object.paths : [];
}

function curveOf(id: string, polylineIndex = 0): CurveSubpath {
  const curve = pathsOf(id)[0]?.curves?.[polylineIndex];
  if (curve === undefined) throw new Error(`missing curve on ${id}`);
  return curve;
}

function segment(objectId: string, segmentIndex: number) {
  return { objectId, pathIndex: 0, polylineIndex: 0, segmentIndex };
}

function node(objectId: string, pointIndex: number) {
  return { objectId, pathIndex: 0, polylineIndex: 0, pointIndex, geometry: 'curve' as const };
}

function expectOneUndoStepFrom(before: Project): void {
  const state = useStore.getState();
  expect(state.undoStack).toHaveLength(1);
  expect(state.undoStack[0]).toBe(before);
  expect(state.redoStack).toEqual([]);
  expect(state.dirty).toBe(true);
}

function expectPenInStep(id: string): void {
  const shape = objectOf(id);
  if (shape.kind !== 'shape' || shape.spec.kind !== 'polyline') throw new Error('not a pen');
  const polyline = shape.paths[0]?.polylines[0];
  expect(shape.paths).toHaveLength(1);
  expect(shape.paths[0]?.curves).toHaveLength(1);
  expect(shape.spec.closed).toBe(polyline?.closed);
  expect(shape.spec.points).toEqual(
    materializedPolylineToSpecPoints(polyline?.points ?? [], polyline?.closed ?? false),
  );
}

function pen(id: string, closed: boolean) {
  return createPolyline({ id, color: '#000000', spec: { closed, points: PEN_POINTS } });
}

function openLine(fromX: number, toX: number): CurveSubpath {
  return {
    start: { x: fromX, y: 0 },
    segments: [{ kind: 'line', to: { x: toX, y: 0 } }],
    closed: false,
  };
}

function openPolyline(points: ReadonlyArray<Vec2>): CurveSubpath {
  return {
    start: points[0] as Vec2,
    segments: points.slice(1).map((to) => ({ kind: 'line' as const, to })),
    closed: false,
  };
}

function curveObject(
  id: string,
  curves: ReadonlyArray<CurveSubpath>,
  transform: Partial<ImportedSvg['transform']> = {},
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: -1, maxX: 30, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, ...transform },
    paths: [
      {
        color: '#000000',
        polylines: curves.map((curve) => ({
          points: [curve.start, ...curve.segments.map((entry) => entry.to)],
          closed: curve.closed,
        })),
        curves,
      },
    ],
  };
}
