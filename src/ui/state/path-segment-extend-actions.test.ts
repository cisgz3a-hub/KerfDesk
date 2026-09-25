import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import { materializedPolylineToSpecPoints } from './path-node-edit-geometry';
import { resetStore } from './test-helpers';
import { useStore } from './store';

const HIDDEN = '#ff0000';

describe('node editor Extend', () => {
  beforeEach(() => resetStore());

  it('runs the end a segment leads to on to other artwork, as one undo step', () => {
    load([art('art', [path([0, 0], [10, 0], [20, 0])]), post('far', 40), post('near', 25)]);
    const before = useStore.getState().project;

    expect(useStore.getState().extendPathSegment(segment('art', 1), 0.2)).toBe('extended');

    expect(curveOf('art').segments[1]).toEqual({ kind: 'line', to: { x: 25, y: 0 } });
    expect(polylineOf('art').points.at(-1)).toEqual({ x: 25, y: 0 });
    const state = useStore.getState();
    expect(state.undoStack).toEqual([before]);
    expect(state.dirty).toBe(true);
  });

  it('runs on from an open end node, but not from an interior one', () => {
    load([art('art', [path([0, 0], [10, 0], [20, 0])]), post('left', -7)]);

    expect(useStore.getState().extendPathAtNode(node('art', 1))).toBe('no-open-end');
    expect(useStore.getState().extendPathAtNode(node('art', 2))).toBe('no-crossing');
    expect(useStore.getState().undoStack).toEqual([]);

    expect(useStore.getState().extendPathAtNode(node('art', 0))).toBe('extended');
    expect(curveOf('art').start).toEqual({ x: -7, y: 0 });
  });

  it('refuses closed paths and interior segments without an undo step', () => {
    const square = { ...path([0, 0], [10, 0], [10, 10], [0, 10]), closed: true };
    load([art('box', [square]), art('zig', [path([0, 20], [10, 20], [10, 30], [20, 30])])]);

    expect(useStore.getState().extendPathSegment(segment('box', 3), 0.5)).toBe('no-open-end');
    expect(useStore.getState().extendPathSegment(segment('zig', 1), 0.5)).toBe('no-open-end');
    expect(useStore.getState().undoStack).toEqual([]);
  });

  it('stops at the artwork’s own other lines and looks past hidden artwork', () => {
    const own = art('art', [path([0, 0], [10, 0]), path([20, -5], [20, 5])]);
    load([own, art('hidden', [path([15, -5], [15, 5])], HIDDEN)]);

    expect(useStore.getState().extendPathSegment(segment('art', 0), 0.9)).toBe('extended');

    expect(curveOf('art').segments[0]?.to).toEqual({ x: 20, y: 0 });
  });

  it('keeps a pen drawing in step', () => {
    const drawing = createPolyline({
      id: 'pen',
      color: '#000000',
      spec: {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    });
    load([drawing, art('wall', [path([-100, 30], [100, 30])])]);

    expect(useStore.getState().extendPathAtNode(node('pen', 2))).toBe('extended');

    const shape = objectOf('pen');
    if (shape.kind !== 'shape' || shape.spec.kind !== 'polyline') throw new Error('not a pen');
    const polyline = shape.paths[0]?.polylines[0];
    expect(shape.spec.points).toEqual(
      materializedPolylineToSpecPoints(polyline?.points ?? [], false),
    );
    expect(shape.spec.points.at(-1)?.y).toBeCloseTo(30, 9);
  });
});

function load(objects: ReadonlyArray<SceneObject>): void {
  const project: Project = {
    ...createProject(),
    scene: {
      objects,
      layers: [
        createLayer({ id: '#000000', color: '#000000' }),
        { ...createLayer({ id: HIDDEN, color: HIDDEN }), visible: false },
      ],
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

function curveOf(id: string): CurveSubpath {
  const object = objectOf(id);
  const curve = 'paths' in object ? object.paths[0]?.curves?.[0] : undefined;
  if (curve === undefined) throw new Error(`missing curve on ${id}`);
  return curve;
}

function polylineOf(id: string) {
  const object = objectOf(id);
  const polyline = 'paths' in object ? object.paths[0]?.polylines[0] : undefined;
  if (polyline === undefined) throw new Error(`missing polyline on ${id}`);
  return polyline;
}

function segment(objectId: string, segmentIndex: number) {
  return { objectId, pathIndex: 0, polylineIndex: 0, segmentIndex };
}

function node(objectId: string, pointIndex: number) {
  return { objectId, pathIndex: 0, polylineIndex: 0, pointIndex, geometry: 'curve' as const };
}

function path(...points: ReadonlyArray<readonly [number, number]>): CurveSubpath {
  const at = (index: number): Vec2 => {
    const point = points[index] ?? [0, 0];
    return { x: point[0], y: point[1] };
  };
  return {
    start: at(0),
    segments: points.slice(1).map((_, index) => ({ kind: 'line' as const, to: at(index + 1) })),
    closed: false,
  };
}

// An upright line through y = 0 at `x`.
function post(id: string, x: number): ImportedSvg {
  return art(id, [path([x, -5], [x, 5])]);
}

function art(id: string, curves: ReadonlyArray<CurveSubpath>, color = '#000000'): ImportedSvg {
  const points = curves.flatMap((curve) => [curve.start, ...curve.segments.map((s) => s.to)]);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: curves.map((curve) => ({
          points: [curve.start, ...curve.segments.map((entry) => entry.to)],
          closed: curve.closed,
        })),
        curves,
      },
    ],
  };
}
