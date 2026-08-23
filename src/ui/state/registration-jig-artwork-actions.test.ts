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
      columns: 5,
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

  it('centers one selected artwork into all five outlines as one edit', () => {
    const beforeUndoCount = useStore.getState().undoStack.length;
    useStore.getState().centerSelectionInRegistrationBox();

    const state = useStore.getState();
    const boxes = findRegistrationBoxes(state.project.scene);
    const artwork = state.project.scene.objects.filter((object) => !isRegistrationBox(object));
    expect(artwork).toHaveLength(5);
    for (const [index, object] of artwork.entries()) {
      expect(centerOf(transformedBBox(object))).toEqual(centerOf(transformedBBox(boxes[index]!)));
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
    expect(artwork).toHaveLength(5);
    for (const copy of artwork) {
      expect(operationIdsForObject(copy, scene.layers)).toEqual(sourceOperationIds);
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
