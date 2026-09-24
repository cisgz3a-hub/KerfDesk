import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
} from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import { resetStore } from './test-helpers';
import { useStore } from './store';

describe('curve node edit actions', () => {
  beforeEach(() => resetStore());

  it('moves canonical anchors and controls without downgrading geometry', () => {
    loadCurve();
    useStore.getState().selectPathNode({
      objectId: 'curve',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 1,
      geometry: 'curve',
    });
    useStore.getState().nudgeSelectedPathNode(3, 2);
    let object = useStore.getState().project.scene.objects[0] as ImportedSvg;
    expect(object.paths[0]?.curves?.[0]?.segments[0]).toMatchObject({
      control2: { x: 11, y: 6 },
      to: { x: 13, y: 2 },
    });
    expect(object.paths[0]?.curves).toHaveLength(1);

    useStore.getState().selectPathNode({
      objectId: 'curve',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 0,
      geometry: 'curve',
      handle: 'outgoing',
    });
    useStore.getState().nudgeSelectedPathNode(-1, 3);
    object = useStore.getState().project.scene.objects[0] as ImportedSvg;
    expect(object.paths[0]?.curves?.[0]?.segments[0]).toMatchObject({
      control1: { x: 1, y: 7 },
    });
    expect(object.paths[0]?.polylines[0]?.points.length).toBeGreaterThan(2);
  });

  it('converts segments, changes the start point, and breaks with undo', () => {
    loadCurves([closedLineCurve()]);
    selectAnchor(1);
    useStore.getState().convertSelectedCurveSegment('cubic');
    let curve = currentCurve();
    expect(curve.segments[1]?.kind).toBe('cubic');
    expect(useStore.getState().undoStack).toHaveLength(1);

    loadCurves([closedLineCurve()]);
    selectAnchor(1);
    useStore.getState().setSelectedCurveStart();
    curve = currentCurve();
    expect(curve.start).toEqual({ x: 10, y: 0 });

    selectAnchor(0);
    useStore.getState().breakSelectedCurve();
    curve = currentCurve();
    expect(curve.closed).toBe(false);
    expect(curve.segments).toHaveLength(1);
  });

  it('smooths, corners, and joins selected curve subpaths', () => {
    loadCurves([twoCubicClosedCurve()]);
    selectAnchor(1);
    useStore.getState().smoothSelectedCurveNode();
    expect(currentCurve().segments).toHaveLength(2);

    selectAnchor(1);
    useStore.getState().cornerSelectedCurveNode();
    expect(currentCurve().segments).toHaveLength(2);

    loadCurves([
      { start: { x: 0, y: 0 }, segments: [{ kind: 'line', to: { x: 2, y: 0 } }], closed: false },
      { start: { x: 5, y: 0 }, segments: [{ kind: 'line', to: { x: 8, y: 0 } }], closed: false },
    ]);
    const state = useStore.getState();
    state.selectPathNode({
      objectId: 'curve',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 1,
      geometry: 'curve',
    });
    state.selectPathNode(
      { objectId: 'curve', pathIndex: 0, polylineIndex: 1, pointIndex: 0, geometry: 'curve' },
      { additive: true },
    );
    useStore.getState().joinSelectedCurveNodes();
    const object = useStore.getState().project.scene.objects[0] as ImportedSvg;
    expect(object.paths[0]?.curves).toHaveLength(1);
    expect(object.paths[0]?.curves?.[0]?.segments).toHaveLength(3);
  });

  it('deletes a selected curve anchor in one undo step and clears the node selection', () => {
    loadCurves([twoCubicOpenCurve()]);
    selectAnchor(1);

    useStore.getState().deleteSelectedPathNodes();

    const state = useStore.getState();
    const curve = currentCurve();
    const path = (state.project.scene.objects[0] as ImportedSvg).paths[0];
    expect(curve.start).toEqual({ x: 0, y: 0 });
    expect(curve.segments).toHaveLength(1);
    expect(curve.segments[0]).toMatchObject({ kind: 'cubic', to: { x: 20, y: 0 } });
    expect(path?.polylines[0]?.points.at(-1)).toEqual({ x: 20, y: 0 });
    expect(path?.polylines[0]?.points.length).toBeGreaterThan(2);
    expect(state.selectedObjectId).toBe('curve');
    expect(state.selectedPathNode).toBeNull();
    expect(state.selectedPathNodes).toEqual([]);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);

    useStore.getState().undo();
    expect(currentCurve()).toEqual(twoCubicOpenCurve());
  });

  it('deletes a curve node of a faired pen drawing and keeps its spec in sync', () => {
    const pen = createPolyline({
      id: 'curve',
      color: '#000000',
      spec: {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 0 },
          { x: 30, y: 10 },
          { x: 40, y: 0 },
        ],
      },
    });
    useStore.setState({
      project: {
        ...createProject(),
        scene: {
          objects: [pen],
          layers: [createLayer({ id: '#000000', color: '#000000' })],
          groups: [],
        },
      },
    });
    selectAnchor(2);

    useStore.getState().deleteSelectedPathNodes();

    const object = useStore.getState().project.scene.objects[0];
    if (object?.kind !== 'shape' || object.spec.kind !== 'polyline') {
      throw new Error('expected an edited polyline shape');
    }
    expect(object.paths[0]?.curves?.[0]?.segments.map((segment) => segment.to)).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 40, y: 0 },
    ]);
    expect(object.spec.points).toEqual(object.paths[0]?.polylines[0]?.points);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('refuses a curve delete that would leave fewer anchors than a polyline allows', () => {
    loadCurves([closedLineCurve()]);
    selectAnchor(1);
    const before = useStore.getState().project;

    useStore.getState().deleteSelectedPathNodes();

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().selectedPathNodes).toHaveLength(1);
  });
});

function loadCurve(): void {
  const path: ColoredPath = {
    color: '#000000',
    polylines: [
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        closed: false,
      },
    ],
    curves: [
      {
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
      },
    ],
  };
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'curve',
    source: 'curve.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 4 },
    transform: IDENTITY_TRANSFORM,
    paths: [path],
  };
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [object],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    },
  });
}

function loadCurves(curves: ReadonlyArray<CurveSubpath>): void {
  loadCurve();
  const object = useStore.getState().project.scene.objects[0] as ImportedSvg;
  useStore.setState({
    project: {
      ...useStore.getState().project,
      scene: {
        ...useStore.getState().project.scene,
        objects: [
          {
            ...object,
            paths: [{ color: '#000000', polylines: curves.map(simplePolyline), curves }],
          },
        ],
      },
    },
    undoStack: [],
    selectedPathNode: null,
    selectedPathNodes: [],
  });
}

function selectAnchor(pointIndex: number): void {
  useStore.getState().selectPathNode({
    objectId: 'curve',
    pathIndex: 0,
    polylineIndex: 0,
    pointIndex,
    geometry: 'curve',
  });
}

function currentCurve(): CurveSubpath {
  const object = useStore.getState().project.scene.objects[0] as ImportedSvg;
  const curve = object.paths[0]?.curves?.[0];
  if (curve === undefined) throw new Error('curve missing');
  return curve;
}

function simplePolyline(curve: CurveSubpath) {
  return {
    points: [curve.start, ...curve.segments.map((segment) => segment.to)],
    closed: curve.closed,
  };
}

function closedLineCurve(): CurveSubpath {
  return {
    start: { x: 0, y: 0 },
    segments: [
      { kind: 'line', to: { x: 10, y: 0 } },
      { kind: 'line', to: { x: 0, y: 0 } },
    ],
    closed: true,
  };
}

function twoCubicOpenCurve(): CurveSubpath {
  return {
    start: { x: 0, y: 0 },
    segments: [
      { kind: 'cubic', control1: { x: 3, y: 4 }, control2: { x: 7, y: 6 }, to: { x: 10, y: 6 } },
      { kind: 'cubic', control1: { x: 13, y: 6 }, control2: { x: 17, y: 4 }, to: { x: 20, y: 0 } },
    ],
    closed: false,
  };
}

function twoCubicClosedCurve(): CurveSubpath {
  return {
    start: { x: 0, y: 0 },
    segments: [
      { kind: 'cubic', control1: { x: 2, y: 0 }, control2: { x: 8, y: 0 }, to: { x: 10, y: 0 } },
      { kind: 'cubic', control1: { x: 10, y: 2 }, control2: { x: 2, y: 10 }, to: { x: 0, y: 0 } },
    ],
    closed: true,
  };
}
