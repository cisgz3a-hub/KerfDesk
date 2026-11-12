import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type ImportedSvg,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const SQUARE: ImportedSvg = {
  kind: 'imported-svg',
  id: 'sq',
  source: 'sq.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
  operationIds: ['cut'],
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  resetStore();
  const rect = createRectangle({
    id: 'rect',
    color: '#000000',
    spec: { widthMm: 5, heightMm: 5, cornerRadiusMm: 0 },
  });
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [SQUARE, rect],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: 'sq',
    additionalSelectedIds: new Set(['rect']),
  });
});

describe('shearSelection', () => {
  it('slants vector artwork about its centre in one undo step and reports what it skipped', () => {
    useStore.getState().shearSelection(45, 0);
    const state = useStore.getState();
    const sheared = state.project.scene.objects[0] as ImportedSvg;
    // A 45 degree horizontal shear about y = 105 widens the 10 mm square to 20 mm.
    const box = transformedBBox(sheared);
    expect(box.maxX - box.minX).toBeCloseTo(20, 9);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(105, 9);
    expect(sheared.transform).toEqual(SQUARE.transform);
    expect(state.project.scene.objects[1]).toBe(useStore.getState().undoStack[0]?.scene.objects[1]);
    expect(state.undoStack).toHaveLength(1);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Sheared 1 object. 1 object was left unchanged: convert text, shapes and images to paths to shear them.',
    );
  });

  it('refuses angles past the limit', () => {
    const before = useStore.getState().project;
    useStore.getState().shearSelection(89, 0);
    expect(useStore.getState().project).toBe(before);
  });

  // T12-P2-1: both slants together collapse the artwork at tan·tan = 1 and
  // mirror and enlarge it beyond, which was applied as "Sheared 1 object.".
  it.each([
    [45, 45],
    [30, 60],
    [-45, -45],
    [44, 45],
    [60, 60],
    [85, 85],
  ])('refuses %s° and %s° together, which would flatten or mirror the artwork', (ax, ay) => {
    const before = useStore.getState().project;
    useStore.getState().shearSelection(ax, ay);
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(
      /^These two angles together would flatten or mirror the artwork/,
    );
  });

  it('still applies two slants that keep the shape', () => {
    useStore.getState().shearSelection(20, 20);
    const sheared = useStore.getState().project.scene.objects[0] as ImportedSvg;
    expect(sheared.paths).not.toEqual(SQUARE.paths);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});
