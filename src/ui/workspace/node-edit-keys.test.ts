import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { handleNodeEditKey } from './node-edit-keys';
import { segmentAngleDeg } from './node-edit-keys';

const TILTED: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 10, y: 1 } },
    { kind: 'line', to: { x: 10, y: 11 } },
  ],
  closed: false,
};

function load(): void {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 11 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', curves: [TILTED], polylines: [{ points: [], closed: false }] }],
  };
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [object],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: 'art',
    additionalSelectedIds: new Set(),
  });
}

const curve = () => {
  const object = useStore.getState().project.scene.objects[0];
  return object !== undefined && 'paths' in object ? object.paths[0]?.curves?.[0] : undefined;
};

beforeEach(() => {
  resetStore();
  load();
});

describe('node tool hover keys', () => {
  it('inserts at the midpoint of the hovered segment and ignores empty space', () => {
    expect(handleNodeEditKey(useStore.getState(), 'm', { x: 10.1, y: 7 }, 0.1)).toBe(true);
    expect(curve()?.segments[1]?.to).toEqual({ x: 10, y: 6 });
    expect(handleNodeEditKey(useStore.getState(), 'm', { x: 50, y: 50 }, 0.1)).toBe(false);
  });

  it('deletes the hovered segment, splitting the open path', () => {
    expect(handleNodeEditKey(useStore.getState(), 'd', { x: 5, y: 0.5 }, 0.1)).toBe(true);
    expect(curve()?.start).toEqual({ x: 10, y: 1 });
  });

  it('turns the selection so the hovered segment lies on the nearest 45°', () => {
    const app = useStore.getState();
    const hit = {
      objectId: 'art',
      pathIndex: 0,
      curveIndex: 0,
      segmentIndex: 0,
      t: 0.5,
      point: { x: 5, y: 0.5 },
    };
    const before = segmentAngleDeg(app.project.scene, hit) ?? Number.NaN;
    expect(before).toBeCloseTo((Math.atan2(1, 10) * 180) / Math.PI, 9);
    expect(handleNodeEditKey(app, 'a', { x: 5, y: 0.5 }, 0.1)).toBe(true);
    const rotation =
      useStore.getState().project.scene.objects[0]?.transform.rotationDeg ?? Number.NaN;
    expect(rotation).toBeCloseTo(360 - before, 9);
  });
});

describe('node tool T key', () => {
  it('trims with auto-join on, like a Trim tool click without Ctrl', () => {
    const calls: unknown[] = [];
    const app = {
      ...useStore.getState(),
      trimShapeAt: (...args: unknown[]) => {
        calls.push(args[2]);
        return true;
      },
    };
    expect(handleNodeEditKey(app, 't', { x: 5, y: 0.5 }, 0.1)).toBe(true);
    expect(calls).toEqual([{ autoJoin: true }]);
  });
});
