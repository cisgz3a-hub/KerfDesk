import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const NEAR: Polyline = {
  closed: false,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0.3, y: 0 },
  ],
};
const FAR: Polyline = {
  closed: false,
  points: [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 10 },
    { x: 25, y: 0 },
  ],
};

function load(): void {
  const art: ImportedSvg = {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines: [NEAR, FAR] }],
  };
  useStore.setState({
    project: {
      ...createProject(),
      scene: { objects: [art], layers: [createLayer({ id: 'cut', color: '#000000' })], groups: [] },
    },
    selectedObjectId: 'art',
    additionalSelectedIds: new Set(),
  });
}

beforeEach(() => {
  resetStore();
  load();
});

describe('closeSelectedPathsWithTolerance', () => {
  it('meets the near ends in one undo step and reports the path left open', () => {
    useStore.getState().closeSelectedPathsWithTolerance(0.5, 'move-ends');
    const state = useStore.getState();
    const object = state.project.scene.objects[0] as ImportedSvg;
    const [near, far] = object.paths[0]?.polylines ?? [];
    expect(near?.closed).toBe(true);
    expect(near?.points[0]).toEqual({ x: 0.15, y: 0 });
    expect(near?.points.at(-1)).toEqual({ x: 0.15, y: 0 });
    expect(far).toBe(FAR);
    expect(state.undoStack).toHaveLength(1);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Closed 1 path. 1 path stays open: the gap is wider than 0.5 mm.',
    );
    useStore.getState().undo();
    expect(
      (useStore.getState().project.scene.objects[0] as ImportedSvg).paths[0]?.polylines[0],
    ).toBe(NEAR);
  });
});
