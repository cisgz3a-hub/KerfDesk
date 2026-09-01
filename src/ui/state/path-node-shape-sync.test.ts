import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type ShapeObject,
} from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import { materializedPolylineToSpecPoints } from './path-node-edit-geometry';
import { resetStore } from './test-helpers';
import { useStore } from './store';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';

describe('polyline Shape node synchronization', () => {
  beforeEach(() => resetStore());

  it('synchronizes one represented subpath and rejects ambiguous extra subpaths', () => {
    const shape = createPolyline({
      id: 'pen',
      color: '#000000',
      spec: { closed: false, points: squarePoints() },
    });
    const path = shape.paths[0]!;
    const closedPath = {
      ...path,
      polylines: [{ ...path.polylines[0]!, closed: true }],
      curves: [{ ...path.curves![0]!, closed: true }],
    };
    expect(
      synchronizePolylineShapeGeometry(shape, [closedPath], {
        minX: 0,
        minY: 0,
        maxX: 10,
        maxY: 10,
      })?.spec,
    ).toMatchObject({ kind: 'polyline', closed: true });

    const second = linePath(20, 30);
    expect(
      synchronizePolylineShapeGeometry(
        shape,
        [
          {
            ...path,
            polylines: [...path.polylines, ...second.polylines],
            curves: [...path.curves!, ...second.curves!],
          },
        ],
        shape.bounds,
      ),
    ).toBeNull();
  });

  it('does not turn accepted multi-subpath Shape node editing into a refusal', () => {
    const shape = createPolyline({
      id: 'pen',
      color: '#000000',
      spec: { closed: false, points: squarePoints() },
    });
    const second = linePath(20, 30);
    const object = {
      ...shape,
      paths: [
        {
          ...shape.paths[0]!,
          polylines: [...shape.paths[0]!.polylines, ...second.polylines],
          curves: [...shape.paths[0]!.curves!, ...second.curves!],
        },
      ],
    };
    const base = createProject();
    useStore.setState({
      project: {
        ...base,
        scene: {
          objects: [object],
          layers: [createLayer({ id: 'line', color: '#000000' })],
          groups: [],
        },
      },
      undoStack: [],
      dirty: false,
    });
    useStore.getState().selectPathNode({
      objectId: 'pen',
      pathIndex: 0,
      polylineIndex: 1,
      pointIndex: 0,
      geometry: 'curve',
    });

    useStore.getState().nudgeSelectedPathNode(3, 2);

    const after = useStore.getState();
    const edited = after.project.scene.objects[0];
    expect(edited?.kind === 'shape' && edited.paths[0]?.curves?.[1]?.start).toEqual({
      x: 23,
      y: 2,
    });
    expect(after.undoStack).toHaveLength(1);
    expect(after.dirty).toBe(true);
  });

  it.each([
    {
      name: 'Smooth',
      curve: closedCubicCurve(),
      pointIndex: 1,
      run: () => useStore.getState().smoothSelectedCurveNode(),
      verify: (curve: CurveSubpath) => expect(curve).not.toEqual(closedCubicCurve()),
    },
    {
      name: 'Corner',
      curve: closedCubicCurve(),
      pointIndex: 1,
      run: () => useStore.getState().cornerSelectedCurveNode(),
      verify: (curve: CurveSubpath) => expect(curve).not.toEqual(closedCubicCurve()),
    },
    {
      name: 'Curve',
      curve: lineCurve(),
      pointIndex: 0,
      run: () => useStore.getState().convertSelectedCurveSegment('cubic'),
      verify: (curve: CurveSubpath) => expect(curve.segments[0]?.kind).toBe('cubic'),
    },
    {
      name: 'Line',
      curve: cubicCurve(),
      pointIndex: 0,
      run: () => useStore.getState().convertSelectedCurveSegment('line'),
      verify: (curve: CurveSubpath) => expect(curve.segments[0]?.kind).toBe('line'),
    },
    {
      name: 'Start',
      curve: closedSquareCurve(),
      pointIndex: 1,
      run: () => useStore.getState().setSelectedCurveStart(),
      verify: (curve: CurveSubpath) => expect(curve.start).toEqual({ x: 10, y: 0 }),
    },
    {
      name: 'Break',
      curve: closedSquareCurve(),
      pointIndex: 1,
      run: () => useStore.getState().breakSelectedCurve(),
      verify: (curve: CurveSubpath) => expect(curve.closed).toBe(false),
    },
  ])(
    'keeps the visible $name command synchronized for a one-subpath polyline Shape',
    ({ curve, pointIndex, run, verify }) => {
      loadShapeCurve(curve);
      useStore.getState().selectPathNode({
        objectId: 'pen',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex,
        geometry: 'curve',
      });
      const beforeProject = useStore.getState().project;

      run();

      const after = useStore.getState();
      const object = after.project.scene.objects[0];
      expect(after.project).not.toBe(beforeProject);
      expect(after.undoStack).toHaveLength(1);
      expect(after.dirty).toBe(true);
      expect(object?.kind).toBe('shape');
      if (object?.kind !== 'shape' || object.spec.kind !== 'polyline') return;
      expect(object.paths).toHaveLength(1);
      expect(object.paths[0]?.curves).toHaveLength(1);
      expect(object.paths[0]?.polylines).toHaveLength(1);
      const nextCurve = object.paths[0]!.curves![0]!;
      const polyline = object.paths[0]!.polylines[0]!;
      expect(object.spec.closed).toBe(polyline.closed);
      expect(object.spec.points).toEqual(
        materializedPolylineToSpecPoints(polyline.points, polyline.closed),
      );
      verify(nextCurve);
    },
  );
});

function loadShapeCurve(curve: CurveSubpath): void {
  const polyline = {
    points: [curve.start, ...curve.segments.map((segment) => segment.to)],
    closed: curve.closed,
  };
  const shape = createPolyline({
    id: 'pen',
    color: '#000000',
    spec: {
      closed: curve.closed,
      points: materializedPolylineToSpecPoints(polyline.points, polyline.closed),
    },
  });
  const object: ShapeObject = {
    ...shape,
    paths: [{ ...shape.paths[0]!, polylines: [polyline], curves: [curve] }],
  };
  const base = createProject();
  useStore.setState({
    project: {
      ...base,
      scene: {
        objects: [object],
        layers: [createLayer({ id: 'line', color: '#000000' })],
        groups: [],
      },
    },
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}

function linePath(startX: number, endX: number): ColoredPath {
  const polyline = {
    points: [
      { x: startX, y: 0 },
      { x: endX, y: 0 },
    ],
    closed: false,
  };
  return {
    color: '#000000',
    polylines: [polyline],
    curves: [polylineToCurveSubpath(polyline)],
  };
}

function lineCurve(): CurveSubpath {
  return {
    start: { x: 0, y: 0 },
    segments: [{ kind: 'line', to: { x: 10, y: 0 } }],
    closed: false,
  };
}

function cubicCurve(): CurveSubpath {
  return {
    start: { x: 0, y: 0 },
    segments: [
      {
        kind: 'cubic',
        control1: { x: 2, y: 4 },
        control2: { x: 8, y: 4 },
        to: { x: 10, y: 0 },
      },
    ],
    closed: false,
  };
}

function closedCubicCurve(): CurveSubpath {
  return {
    start: { x: 0, y: 0 },
    segments: [
      {
        kind: 'cubic',
        control1: { x: 2, y: 0 },
        control2: { x: 8, y: 0 },
        to: { x: 10, y: 0 },
      },
      {
        kind: 'cubic',
        control1: { x: 12, y: 2 },
        control2: { x: 8, y: 8 },
        to: { x: 5, y: 10 },
      },
      {
        kind: 'cubic',
        control1: { x: 2, y: 12 },
        control2: { x: 0, y: 2 },
        to: { x: 0, y: 0 },
      },
    ],
    closed: true,
  };
}

function closedSquareCurve(): CurveSubpath {
  return {
    start: { x: 0, y: 0 },
    segments: [
      { kind: 'line', to: { x: 10, y: 0 } },
      { kind: 'line', to: { x: 10, y: 10 } },
      { kind: 'line', to: { x: 0, y: 10 } },
      { kind: 'line', to: { x: 0, y: 0 } },
    ],
    closed: true,
  };
}

function squarePoints() {
  return [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
}
