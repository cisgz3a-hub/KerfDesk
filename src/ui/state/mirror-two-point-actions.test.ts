import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
} from '../../core/scene';
import { twoPointMotion } from '../workspace/two-point-tool';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function art(id: string, polyline: Polyline): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines: [polyline] }],
  };
}

const TRIANGLE: Polyline = {
  closed: true,
  points: [
    { x: 1, y: 1 },
    { x: 4, y: 1 },
    { x: 1, y: 3 },
  ],
};
const VERTICAL_LINE: Polyline = {
  closed: false,
  points: [
    { x: 6, y: 0 },
    { x: 6, y: 10 },
  ],
};

function load(selected: ReadonlyArray<string>): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [art('shape', TRIANGLE), art('line', VERTICAL_LINE)],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    undoStack: [],
  });
}

beforeEach(() => resetStore());

describe('Mirror Across Line', () => {
  it('adds a mirrored copy across the last selected straight line in one undo step', () => {
    load(['shape', 'line']);
    useStore.getState().mirrorSelectionAcrossLine();
    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(3);
    const copy = state.project.scene.objects.find((object) => object.id === state.selectedObjectId);
    if (copy === undefined || !('paths' in copy)) throw new Error('copy missing');
    const world = copy.paths[0]?.polylines[0]?.points.map((point) =>
      applyTransform(point, copy.transform),
    );
    expect(world?.map((point) => [Number(point.x.toFixed(9)), Number(point.y.toFixed(9))])).toEqual(
      [
        [11, 1],
        [8, 1],
        [11, 3],
      ],
    );
    expect(state.undoStack).toHaveLength(1);
  });

  it('explains what it needs when the last object is not a straight line', () => {
    load(['line', 'shape']);
    useStore.getState().mirrorSelectionAcrossLine();
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
  });
});

describe('Two-Point Rotate / Scale', () => {
  it('turns and scales the selection about the picked pivot', () => {
    load(['shape']);
    const motion = twoPointMotion({ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 1, y: 7 }, true);
    expect(motion?.deltaDeg).toBeCloseTo(90, 9);
    expect(motion?.scale).toBeCloseTo(2, 9);
    useStore.getState().rotateScaleSelectionAbout({ x: 1, y: 1 }, 90, 2);
    const object = useStore.getState().project.scene.objects[0];
    if (object === undefined) throw new Error('missing');
    const moved = applyTransform({ x: 4, y: 1 }, object.transform);
    expect(moved.x).toBeCloseTo(1, 9);
    expect(moved.y).toBeCloseTo(7, 9);
  });
});
