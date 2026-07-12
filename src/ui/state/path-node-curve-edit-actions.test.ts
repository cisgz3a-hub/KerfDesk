import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
} from '../../core/scene';
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
