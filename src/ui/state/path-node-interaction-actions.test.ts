import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  curveControlPoint,
  curveNodePoint,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { pointOnSegment } from '../../core/geometry/curve-segment-geometry';
import { createPolyline } from '../../core/shapes';
import { materializedPolylineToSpecPoints } from './path-node-edit-geometry';
import { resetStore } from './test-helpers';
import { useStore } from './store';

const SMOOTH: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'cubic', control1: { x: 2, y: 4 }, control2: { x: 6, y: 0 }, to: { x: 10, y: 0 } },
    { kind: 'cubic', control1: { x: 12, y: 0 }, control2: { x: 18, y: 6 }, to: { x: 20, y: 10 } },
  ],
  closed: false,
};

describe('node editor drags', () => {
  beforeEach(() => resetStore());

  it('keeps a smooth node smooth while its handle is dragged, as one undo step', () => {
    load([artwork('art', [SMOOTH])]);
    const before = useStore.getState().project;
    const handle = { ...node('art', 1), handle: 'outgoing' as const };
    useStore.getState().selectPathNode(handle);

    useStore.getState().beginInteraction();
    useStore.getState().moveSelectedPathNodesDuringInteraction(handle, { x: 13, y: 3 });
    useStore.getState().moveSelectedPathNodesDuringInteraction(handle, { x: 14, y: 4 });
    useStore.getState().endInteraction();

    const curve = curveOf('art');
    const anchor = curveNodePoint(curve, 1) as Vec2;
    const incoming = curveControlPoint(curve, 1, 'incoming') as Vec2;
    const outgoing = curveControlPoint(curve, 1, 'outgoing') as Vec2;
    expect(outgoing).toEqual({ x: 14, y: 4 });
    const cross =
      (incoming.x - anchor.x) * (outgoing.y - anchor.y) -
      (incoming.y - anchor.y) * (outgoing.x - anchor.x);
    expect(cross).toBeCloseTo(0, 9);
    expect(Math.hypot(incoming.x - anchor.x, incoming.y - anchor.y)).toBeCloseTo(4, 9);
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it('mirrors the handle length with the modifier', () => {
    load([artwork('art', [SMOOTH])]);
    const handle = { ...node('art', 1), handle: 'incoming' as const };
    useStore.getState().selectPathNode(handle);
    useStore.getState().beginInteraction();
    useStore
      .getState()
      .moveSelectedPathNodesDuringInteraction(handle, { x: 7, y: -4 }, { mirrorHandle: true });
    useStore.getState().endInteraction();
    expect(curveControlPoint(curveOf('art'), 1, 'outgoing')).toEqual({ x: 13, y: 4 });
  });

  it('moves the grabbed node to the pointer even when another node is primary', () => {
    load([artwork('art', [line([0, 10, 20])])]);
    useStore.getState().selectPathNode(node('art', 1));
    useStore.getState().selectPathNode(node('art', 2), { additive: true });
    useStore.getState().beginInteraction();
    useStore.getState().moveSelectedPathNodesDuringInteraction(node('art', 1), { x: 10, y: 5 });
    useStore.getState().endInteraction();
    const curve = curveOf('art');
    expect(curveNodePoint(curve, 1)).toEqual({ x: 10, y: 5 });
    expect(curveNodePoint(curve, 2)).toEqual({ x: 20, y: 5 });
  });

  it('bends a straight segment from its original shape on every move', () => {
    load([artwork('art', [line([0, 10, 20])])]);
    const before = useStore.getState().project;
    const ref = { objectId: 'art', pathIndex: 0, polylineIndex: 0, segmentIndex: 0 };

    useStore.getState().beginInteraction();
    useStore.getState().bendPathSegmentDuringInteraction(ref, 0.5, { x: 5, y: 9 });
    useStore.getState().bendPathSegmentDuringInteraction(ref, 0.5, { x: 5, y: 4 });
    useStore.getState().endInteraction();

    const curve = curveOf('art');
    const bent = curve.segments[0];
    expect(bent?.kind).toBe('cubic');
    const point = pointOnSegment(curve.start, bent!, 0.5);
    expect(point.x).toBeCloseTo(5, 9);
    expect(point.y).toBeCloseTo(4, 9);
    expect(curve.segments[1]).toEqual({ kind: 'line', to: { x: 20, y: 0 } });
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it('bends a pen drawing and keeps its spec in step', () => {
    const pen = createPolyline({
      id: 'pen',
      color: '#000000',
      spec: {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    });
    load([pen]);
    const ref = { objectId: 'pen', pathIndex: 0, polylineIndex: 0, segmentIndex: 0 };
    useStore.getState().beginInteraction();
    useStore.getState().bendPathSegmentDuringInteraction(ref, 0.5, { x: 5, y: -6 });
    useStore.getState().endInteraction();
    const shape = objectOf('pen');
    if (shape.kind !== 'shape' || shape.spec.kind !== 'polyline') throw new Error('pen');
    const polyline = shape.paths[0]?.polylines[0];
    expect(shape.spec.points).toEqual(
      materializedPolylineToSpecPoints(polyline?.points ?? [], true),
    );
    expect(shape.spec.points.some((point) => point.y < -1)).toBe(true);
  });

  it('rolls a cancelled bend back without an undo entry', () => {
    load([artwork('art', [line([0, 10])])]);
    const before = useStore.getState().project;
    const ref = { objectId: 'art', pathIndex: 0, polylineIndex: 0, segmentIndex: 0 };
    useStore.getState().beginInteraction();
    useStore.getState().bendPathSegmentDuringInteraction(ref, 0.5, { x: 5, y: 9 });
    useStore.getState().cancelInteraction();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toEqual([]);
  });

  it('joins two open ends dropped on each other within the same gesture', () => {
    load([artwork('art', [line([0, 10]), line([12, 20])])]);
    const before = useStore.getState().project;
    const dragged = node('art', 1);
    const target = { ...node('art', 0), polylineIndex: 1 };
    useStore.getState().selectPathNode(dragged);

    useStore.getState().beginInteraction();
    useStore.getState().moveSelectedPathNodesDuringInteraction(dragged, { x: 12, y: 0.001 });
    expect(useStore.getState().joinPathEndpointsDuringInteraction(dragged, target)).toBe(true);
    useStore.getState().endInteraction();

    const object = objectOf('art');
    const curves = 'paths' in object ? object.paths[0]?.curves : undefined;
    expect(curves).toHaveLength(1);
    expect(curves?.[0]?.segments.map((segment) => segment.to)).toEqual([
      { x: 12, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().selectedPathNodes).toEqual([]);
  });

  it('closes a path whose end is dropped on its own start', () => {
    load([artwork('art', [line([0, 10, 20])])]);
    const dragged = node('art', 2);
    useStore.getState().beginInteraction();
    expect(useStore.getState().joinPathEndpointsDuringInteraction(dragged, node('art', 0))).toBe(
      true,
    );
    useStore.getState().endInteraction();
    const curve = curveOf('art');
    expect(curve.closed).toBe(true);
    expect(curve.segments.at(-1)?.to).toEqual({ x: 0, y: 0 });
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

function curveOf(id: string): CurveSubpath {
  const object = objectOf(id);
  const curve = 'paths' in object ? object.paths[0]?.curves?.[0] : undefined;
  if (curve === undefined) throw new Error(`missing curve on ${id}`);
  return curve;
}

function node(objectId: string, pointIndex: number) {
  return { objectId, pathIndex: 0, polylineIndex: 0, pointIndex, geometry: 'curve' as const };
}

function line(xs: ReadonlyArray<number>): CurveSubpath {
  return {
    start: { x: xs[0] ?? 0, y: 0 },
    segments: xs.slice(1).map((x) => ({ kind: 'line' as const, to: { x, y: 0 } })),
    closed: false,
  };
}

function artwork(id: string, curves: ReadonlyArray<CurveSubpath>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
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
