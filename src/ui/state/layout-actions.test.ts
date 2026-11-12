import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalArtworkOrder } from '../../core/artwork-order';
import { combinedBBox, IDENTITY_TRANSFORM } from '../../core/scene';
import { resetStore, svgObj } from './test-helpers';
import { useStore } from './store';

const ids = () => useStore.getState().project.scene.objects.map((object) => object.id);

describe('layout actions', () => {
  beforeEach(() => resetStore());

  it('restacks the selection as one undoable edit without changing the cut order', () => {
    for (const id of ['A', 'B', 'C']) useStore.getState().importSvgObject(svgObj(id, ['#ff0000']));
    const cutOrder = canonicalArtworkOrder(useStore.getState().project.scene);
    useStore.setState({ selectedObjectId: 'A', additionalSelectedIds: new Set(), undoStack: [] });

    useStore.getState().moveSelectionInDrawOrder('front');

    expect(ids()).toEqual(['B', 'C', 'A']);
    expect(canonicalArtworkOrder(useStore.getState().project.scene)).toEqual(cutOrder);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(ids()).toEqual(['A', 'B', 'C']);
  });

  it('matches the width of the first object in draw order and packs the selection together', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));
    const width = (id: string) => {
      const object = useStore.getState().project.scene.objects.find((entry) => entry.id === id);
      const box = object === undefined ? null : combinedBBox([object]);
      return box === null ? Number.NaN : box.maxX - box.minX;
    };
    const box = (id: string) =>
      combinedBBox(useStore.getState().project.scene.objects.filter((object) => object.id === id));
    useStore.getState().applySelectionTransforms([
      { id: 'A', transform: { ...IDENTITY_TRANSFORM, scaleX: 2 } },
      { id: 'B', transform: { ...IDENTITY_TRANSFORM, x: 500 } },
    ]);
    const reference = width('A');
    const referenceBox = box('A');
    // No click order (ADR-709): A, the bottom of the stack, is the reference
    // though B is listed last.
    useStore.setState({ selectedObjectId: 'A', additionalSelectedIds: new Set(['B']) });

    useStore.getState().matchSelectionSize('width', false);
    expect(width('A')).toBeCloseTo(reference, 9);
    expect(width('B')).toBeCloseTo(reference, 9);

    useStore.getState().moveSelectionTogether('horizontal');
    const a = box('A');
    const b = box('B');
    expect(a?.minX).toBeCloseTo(referenceBox?.minX ?? Number.NaN, 9);
    expect(a?.maxX).toBeCloseTo(b?.minX ?? Number.NaN, 9);
  });
});
