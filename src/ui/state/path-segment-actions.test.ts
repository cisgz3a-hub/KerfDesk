import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const SQUARE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 10, y: 0 } },
    { kind: 'line', to: { x: 10, y: 10 } },
    { kind: 'line', to: { x: 0, y: 10 } },
    { kind: 'line', to: { x: 0, y: 0 } },
  ],
  closed: true,
};

const ZIGZAG: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 10, y: 0 } },
    { kind: 'line', to: { x: 10, y: 10 } },
    { kind: 'line', to: { x: 20, y: 10 } },
  ],
  closed: false,
};

function art(curves: ReadonlyArray<CurveSubpath>, patch: Partial<ImportedSvg> = {}): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [
      { color: '#000000', curves, polylines: curves.map(() => ({ points: [], closed: false })) },
    ],
    ...patch,
  };
}

function load(object: ImportedSvg): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [object],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    undoStack: [],
  });
}

const curves = () => {
  const object = useStore.getState().project.scene.objects[0];
  return object !== undefined && 'paths' in object ? (object.paths[0]?.curves ?? []) : [];
};

const segment = (curveIndex: number, segmentIndex: number, t = 0.5) => ({
  objectId: 'art',
  pathIndex: 0,
  curveIndex,
  segmentIndex,
  t,
});

beforeEach(() => resetStore());

describe('path segment actions', () => {
  it('inserts a node at the pointer or the midpoint as one undo step', () => {
    load(art([SQUARE]));
    useStore.getState().insertPathNode(segment(0, 1, 0.25), 'point');
    expect(curves()[0]?.segments.map((part) => part.to)[1]).toEqual({ x: 10, y: 2.5 });
    useStore.getState().insertPathNode(segment(0, 0, 0.9), 'midpoint');
    expect(curves()[0]?.segments[0]?.to).toEqual({ x: 5, y: 0 });
    expect(useStore.getState().undoStack).toHaveLength(2);
    useStore.getState().undo();
    useStore.getState().undo();
    expect(curves()[0]).toEqual(SQUARE);
  });

  it('deletes a segment, opening a closed path and splitting an open one', () => {
    load(art([SQUARE]));
    useStore.getState().deletePathSegment(segment(0, 2));
    expect(curves()).toEqual([
      {
        start: { x: 0, y: 10 },
        segments: SQUARE.segments.slice(3).concat(SQUARE.segments.slice(0, 2)),
        closed: false,
      },
    ]);

    load(
      art([ZIGZAG, SQUARE], {
        laserTabAnchors: [{ layerColor: '#000000', pathIndex: 0, polylineIndex: 1, pathT: 0.2 }],
      }),
    );
    useStore.getState().deletePathSegment(segment(0, 1));
    expect(curves().map((curve) => [curve.start, curve.segments.length, curve.closed])).toEqual([
      [{ x: 0, y: 0 }, 1, false],
      [{ x: 10, y: 10 }, 1, false],
      [{ x: 0, y: 0 }, 4, true],
    ]);
    const object = useStore.getState().project.scene.objects[0];
    expect(object?.laserTabAnchors?.[0]?.polylineIndex).toBe(2);
  });

  it('breaks an open path in two at the selected node', () => {
    load(art([ZIGZAG]));
    useStore.getState().selectPathNode({
      objectId: 'art',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 2,
      geometry: 'curve',
    });
    useStore.getState().breakSelectedCurve();
    expect(curves().map((curve) => [curve.start, curve.segments.length])).toEqual([
      [{ x: 0, y: 0 }, 2],
      [{ x: 10, y: 10 }, 1],
    ]);
  });
});
