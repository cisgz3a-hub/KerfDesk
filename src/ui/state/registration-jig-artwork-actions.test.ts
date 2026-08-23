import { beforeEach, describe, expect, it } from 'vitest';
import {
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  isRegistrationBox,
  operationIdsForObject,
  transformedBBox,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from './store';
import { resetStore } from './test-helpers';

describe('center artwork in a registration jig set', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().replaceRegistrationJigSet({
      outline: { kind: 'rectangle', widthMm: 50, heightMm: 40 },
      rows: 1,
      columns: 6,
      spacingX: 10,
      spacingY: 0,
    });
    useStore.getState().drawShape(
      createRectangle({
        id: 'art',
        color: '#0000ff',
        spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 },
      }),
    );
  });

  it('auto-fits one selected artwork into all six outlines as one edit', () => {
    const beforeUndoCount = useStore.getState().undoStack.length;
    useStore.getState().centerSelectionInRegistrationBox();

    const state = useStore.getState();
    const boxes = findRegistrationBoxes(state.project.scene);
    const artwork = state.project.scene.objects.filter((object) => !isRegistrationBox(object));
    expect(artwork).toHaveLength(6);
    for (const [index, object] of artwork.entries()) {
      const bounds = transformedBBox(object);
      expect(centerOf(bounds)).toEqual(centerOf(transformedBBox(boxes[index]!)));
      expect(bounds.maxX - bounds.minX).toBeCloseTo(45);
      expect(bounds.maxY - bounds.minY).toBeCloseTo(22.5);
    }
    expect(state.undoStack).toHaveLength(beforeUndoCount + 1);
  });

  it('keeps every artwork copy on the source operations', () => {
    const before = useStore.getState().project.scene;
    const source = before.objects.find((object) => object.id === 'art');
    if (source === undefined) throw new Error('source artwork missing');
    const sourceOperationIds = operationIdsForObject(source, before.layers);

    useStore.getState().centerSelectionInRegistrationBox();

    const scene = useStore.getState().project.scene;
    const artwork = scene.objects.filter((object) => !isRegistrationBox(object));
    expect(artwork).toHaveLength(6);
    for (const copy of artwork) {
      expect(operationIdsForObject(copy, scene.layers)).toEqual(sourceOperationIds);
    }
  });

  it('replaces its generated copies instead of multiplying them on a second click', () => {
    useStore.getState().centerSelectionInRegistrationBox();
    const firstIds = useStore
      .getState()
      .project.scene.objects.filter((object) => !isRegistrationBox(object))
      .map((object) => object.id);

    useStore.getState().centerSelectionInRegistrationBox();

    const state = useStore.getState();
    const artwork = state.project.scene.objects.filter((object) => !isRegistrationBox(object));
    expect(artwork).toHaveLength(6);
    expect(artwork.map((object) => object.id)).toEqual(firstIds);
    expect(state.selectedObjectId).toBe('art');
    expect(state.additionalSelectedIds).toEqual(new Set());
  });

  it('uses the circle-safe fit region for round jig outlines', () => {
    useStore.getState().replaceRegistrationJigSet({
      outline: { kind: 'circle', diameterMm: 50 },
      rows: 1,
      columns: 2,
      spacingX: 10,
      spacingY: 0,
    });
    useStore.setState({ selectedObjectId: 'art', additionalSelectedIds: new Set() });

    useStore.getState().centerSelectionInRegistrationBox();

    const scene = useStore.getState().project.scene;
    const boxes = findRegistrationBoxes(scene);
    const artwork = scene.objects.filter((object) => !isRegistrationBox(object));
    expect(artwork).toHaveLength(2);
    for (const [index, object] of artwork.entries()) {
      const bounds = transformedBBox(object);
      expect(centerOf(bounds)).toEqual(centerOf(transformedBBox(boxes[index]!)));
      expect(bounds.maxX - bounds.minX).toBeCloseTo((50 / Math.SQRT2) * 0.9);
      expect(bounds.maxY - bounds.minY).toBeCloseTo((25 / Math.SQRT2) * 0.9);
    }
  });

  it('fits a selected group as one layout and preserves that group in every jig', () => {
    useStore.getState().drawShape(
      createRectangle({
        id: 'art-right',
        color: '#0000ff',
        spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 30, y: 0 },
      }),
    );
    useStore.setState({ selectedObjectId: 'art', additionalSelectedIds: new Set(['art-right']) });
    useStore.getState().groupSelection();

    useStore.getState().centerSelectionInRegistrationBox();

    const scene = useStore.getState().project.scene;
    const artwork = scene.objects.filter((object) => !isRegistrationBox(object));
    expect(artwork).toHaveLength(12);
    expect(scene.groups).toHaveLength(6);
    for (const box of findRegistrationBoxes(scene)) {
      const boxCenter = centerOf(transformedBBox(box));
      const inBox = artwork.filter((object) => {
        const center = centerOf(transformedBBox(object));
        return Math.abs(center.x - boxCenter.x) < 30 && Math.abs(center.y - boxCenter.y) < 20;
      });
      expect(inBox).toHaveLength(2);
    }
  });
});

function centerOf(bounds: {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}): { readonly x: number; readonly y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}
