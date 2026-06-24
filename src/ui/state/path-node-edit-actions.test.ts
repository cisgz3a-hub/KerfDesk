import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type RasterImage,
} from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import { resetStore } from './test-helpers';
import { useStore } from './store';

describe('path node edit actions', () => {
  beforeEach(() => resetStore());

  it('selects and nudges an imported SVG node with undoable bounds updates', () => {
    loadObjects([importedSvg('logo', [pathWithPolyline('#000000', false, squarePoints())])]);
    useStore.setState({ dirty: false });

    useStore.getState().selectPathNode({
      objectId: 'logo',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 2,
    });
    useStore.getState().nudgeSelectedPathNode(3, -2);

    const state = useStore.getState();
    const object = state.project.scene.objects[0] as ImportedSvg | undefined;
    const point = object?.paths[0]?.polylines[0]?.points[2];

    expect(state.selectedPathNode).toEqual({
      objectId: 'logo',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 2,
    });
    expect(point).toEqual({ x: 13, y: 8 });
    expect(object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 13, maxY: 10 });
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);

    useStore.getState().undo();

    const restored = useStore.getState().project.scene.objects[0] as ImportedSvg | undefined;
    expect(restored?.paths[0]?.polylines[0]?.points[2]).toEqual({ x: 10, y: 10 });
  });

  it('keeps a polyline shape spec in sync with the edited path point', () => {
    const shape = createPolyline({
      id: 'pen',
      color: '#000000',
      spec: {
        closed: false,
        points: [
          { x: 2, y: 3 },
          { x: 8, y: 3 },
          { x: 8, y: 7 },
        ],
      },
    });
    loadObjects([shape]);

    useStore.getState().selectPathNode({
      objectId: 'pen',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 1,
    });
    useStore.getState().nudgeSelectedPathNode(-4, 5);

    const object = useStore.getState().project.scene.objects[0];
    if (object?.kind !== 'shape' || object.spec.kind !== 'polyline') {
      throw new Error('expected edited polyline shape');
    }
    expect(object.paths[0]?.polylines[0]?.points[1]).toEqual({ x: 4, y: 8 });
    expect(object.spec.points[1]).toEqual({ x: 4, y: 8 });
    expect(object.bounds).toEqual({ minX: 2, minY: 3, maxX: 8, maxY: 8 });
  });

  it('sets a selected node position as one undoable interaction for mouse drag', () => {
    loadObjects([importedSvg('logo', [pathWithPolyline('#000000', false, squarePoints())])]);
    useStore.getState().selectPathNode({
      objectId: 'logo',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 1,
    });
    useStore.setState({ undoStack: [], dirty: false });

    useStore.getState().beginInteraction();
    useStore.getState().setSelectedPathNodePositionDuringInteraction({ x: 14, y: 6 });

    const during = useStore.getState();
    const duringObject = during.project.scene.objects[0] as ImportedSvg | undefined;
    expect(duringObject?.paths[0]?.polylines[0]?.points[1]).toEqual({ x: 14, y: 6 });
    expect(duringObject?.bounds).toEqual({ minX: 0, minY: 0, maxX: 14, maxY: 10 });
    expect(during.undoStack).toHaveLength(0);
    expect(during.dirty).toBe(true);

    useStore.getState().endInteraction();

    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    const restored = useStore.getState().project.scene.objects[0] as ImportedSvg | undefined;
    expect(restored?.paths[0]?.polylines[0]?.points[1]).toEqual({ x: 10, y: 0 });
  });

  it('converts dragged scene coordinates into local node coordinates for transformed vectors', () => {
    loadObjects([
      {
        ...importedSvg('logo', [pathWithPolyline('#000000', false, squarePoints())]),
        transform: { ...IDENTITY_TRANSFORM, x: 20, y: 30, scaleX: 2, scaleY: 2 },
      },
    ]);
    useStore.getState().selectPathNode({
      objectId: 'logo',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 2,
    });

    useStore.getState().beginInteraction();
    useStore.getState().setSelectedPathNodePositionDuringInteraction({ x: 50, y: 62 });
    useStore.getState().endInteraction();

    const object = useStore.getState().project.scene.objects[0] as ImportedSvg | undefined;
    expect(object?.paths[0]?.polylines[0]?.points[2]).toEqual({ x: 15, y: 16 });
    expect(object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 15, maxY: 16 });
  });

  it('nudges transformed vector nodes by scene millimeters instead of local units', () => {
    loadObjects([
      {
        ...importedSvg('logo', [pathWithPolyline('#000000', false, squarePoints())]),
        transform: { ...IDENTITY_TRANSFORM, x: 20, y: 30, scaleX: 2, scaleY: 2 },
      },
    ]);
    useStore.getState().selectPathNode({
      objectId: 'logo',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 2,
    });

    useStore.getState().nudgeSelectedPathNode(1, -3);

    const object = useStore.getState().project.scene.objects[0] as ImportedSvg | undefined;
    expect(object?.paths[0]?.polylines[0]?.points[2]).toEqual({ x: 10.5, y: 8.5 });
    expect(object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 10.5, maxY: 10 });
  });

  it('shift-selects multiple nodes on one vector and nudges them together', () => {
    loadObjects([importedSvg('logo', [pathWithPolyline('#000000', false, squarePoints())])]);
    useStore.setState({ dirty: false });

    useStore.getState().selectPathNode({
      objectId: 'logo',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 0,
    });
    useStore.getState().selectPathNode(
      {
        objectId: 'logo',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex: 2,
      },
      { additive: true },
    );

    useStore.getState().nudgeSelectedPathNode(2, 3);

    const state = useStore.getState();
    const object = state.project.scene.objects[0] as ImportedSvg | undefined;
    expect(state.selectedPathNodes).toEqual([
      { objectId: 'logo', pathIndex: 0, polylineIndex: 0, pointIndex: 0 },
      { objectId: 'logo', pathIndex: 0, polylineIndex: 0, pointIndex: 2 },
    ]);
    expect(object?.paths[0]?.polylines[0]?.points[0]).toEqual({ x: 2, y: 3 });
    expect(object?.paths[0]?.polylines[0]?.points[2]).toEqual({ x: 12, y: 13 });
    expect(object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 12, maxY: 13 });
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it('deletes selected open polyline nodes without deleting the object', () => {
    loadObjects([importedSvg('logo', [pathWithPolyline('#000000', false, squarePoints())])]);
    useStore.setState({ dirty: false });
    useStore.getState().selectPathNode({
      objectId: 'logo',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 0,
    });
    useStore.getState().selectPathNode(
      {
        objectId: 'logo',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex: 2,
      },
      { additive: true },
    );

    useStore.getState().deleteSelectedPathNodes();

    const state = useStore.getState();
    const object = state.project.scene.objects[0] as ImportedSvg | undefined;
    expect(state.project.scene.objects).toHaveLength(1);
    expect(object?.paths[0]?.polylines[0]?.points).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]);
    expect(object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(state.selectedObjectId).toBe('logo');
    expect(state.selectedPathNode).toBeNull();
    expect(state.selectedPathNodes).toEqual([]);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);

    useStore.getState().undo();
    const restored = useStore.getState().project.scene.objects[0] as ImportedSvg | undefined;
    expect(restored?.paths[0]?.polylines[0]?.points).toEqual(squarePoints());
  });

  it('keeps polyline shape specs in sync when deleting selected nodes', () => {
    const shape = createPolyline({
      id: 'pen',
      color: '#000000',
      spec: {
        closed: false,
        points: [
          { x: 2, y: 3 },
          { x: 8, y: 3 },
          { x: 8, y: 7 },
        ],
      },
    });
    loadObjects([shape]);
    useStore.getState().selectPathNode({
      objectId: 'pen',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 1,
    });

    useStore.getState().deleteSelectedPathNodes();

    const object = useStore.getState().project.scene.objects[0];
    if (object?.kind !== 'shape' || object.spec.kind !== 'polyline') {
      throw new Error('expected edited polyline shape');
    }
    expect(object.paths[0]?.polylines[0]?.points).toEqual([
      { x: 2, y: 3 },
      { x: 8, y: 7 },
    ]);
    expect(object.spec.points).toEqual([
      { x: 2, y: 3 },
      { x: 8, y: 7 },
    ]);
    expect(object.bounds).toEqual({ minX: 2, minY: 3, maxX: 8, maxY: 7 });
  });

  it('does not delete nodes when the remaining contour would be invalid', () => {
    loadObjects([importedSvg('logo', [pathWithPolyline('#000000', false, squarePoints())])]);
    useStore.getState().selectPathNode({
      objectId: 'logo',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 0,
    });
    useStore.getState().selectPathNode(
      {
        objectId: 'logo',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex: 1,
      },
      { additive: true },
    );
    useStore.getState().selectPathNode(
      {
        objectId: 'logo',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex: 2,
      },
      { additive: true },
    );
    const before = useStore.getState().project;

    useStore.getState().deleteSelectedPathNodes();

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('does not edit locked, raster, or missing node references', () => {
    loadObjects([
      {
        ...importedSvg('locked', [pathWithPolyline('#000000', false, squarePoints())]),
        locked: true,
      },
      rasterImage('raster'),
    ]);
    const before = useStore.getState().project;

    useStore.getState().selectPathNode({
      objectId: 'locked',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 0,
    });
    useStore.getState().nudgeSelectedPathNode(1, 1);
    useStore.getState().selectPathNode({
      objectId: 'raster',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 0,
    });
    useStore.getState().nudgeSelectedPathNode(1, 1);
    useStore.getState().selectPathNode({
      objectId: 'missing',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 0,
    });
    useStore.getState().nudgeSelectedPathNode(1, 1);
    useStore.getState().deleteSelectedPathNodes();

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

function loadObjects(
  objects: ReadonlyArray<ImportedSvg | RasterImage | ReturnType<typeof createPolyline>>,
): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects,
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    },
    selectedPathNode: null,
    selectedPathNodes: [],
  });
}

function importedSvg(id: string, paths: ReadonlyArray<ColoredPath>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

function pathWithPolyline(
  color: string,
  closed: boolean,
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): ColoredPath {
  return { color, polylines: [{ closed, points }] };
}

function squarePoints(): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  return [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
}

function rasterImage(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 10,
    lumaBase64: 'gA==',
  };
}
