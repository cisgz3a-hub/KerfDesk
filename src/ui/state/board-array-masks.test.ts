import { beforeEach, describe, expect, it } from 'vitest';
import {
  burnedCellsPerPhoto,
  maskedPhotos,
  masksOverTheirPhotos,
  offImageAdvisories,
  setUpMaskedPhotoOnBoard,
} from './board-array-masks.test-support';
import { selectedBoardArrayDesign, selectedBoardFitDesign } from './board-tile-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';

// Rolling audit v5 J9-P1-1 (ADR-633 Amendment 3): Array on board moved the
// photo off its mask and gave every copy the original's mask, so each of a
// 2 × 2 array's tiles burned a quarter of the circle while the canvas drew
// four whole photos, and Job Review said nothing.

const TWO_BY_TWO = { kind: 'grid', rows: 2, cols: 2, gapXMm: 2, gapYMm: 2 } as const;

function select(ids: ReadonlyArray<string>): void {
  const [first, ...rest] = ids;
  useStore.setState({ selectedObjectId: first ?? null, additionalSelectedIds: new Set(rest) });
}

describe('Array on board with a masked photo', () => {
  beforeEach(() => {
    resetStore();
    setUpMaskedPhotoOnBoard();
  });

  it.each([
    ['only the photo', ['photo']],
    ['the photo and its mask', ['photo', 'mask']],
    ['the mask and its photo', ['mask', 'photo']],
  ])('burns the whole masked photo in every tile when %s is selected', (_label, selection) => {
    const [whole] = burnedCellsPerPhoto();
    expect(whole).toBeGreaterThan(0);

    select(selection);
    expect(selectedBoardArrayDesign(useStore.getState())?.id).toBe('photo');
    useStore.getState().tileSelectionIntoBoard(TWO_BY_TWO);

    expect(burnedCellsPerPhoto()).toEqual([whole, whole, whole, whole]);
    expect(masksOverTheirPhotos()).toEqual([true, true, true, true]);
    expect(new Set(maskedPhotos().map((photo) => photo.imageMaskId)).size).toBe(4);
    expect(offImageAdvisories()).toEqual([]);
  });

  it('selects the array of what was selected, and undoes in one step', () => {
    const before = useStore.getState().project.scene.objects.map((object) => object.id);
    select(['photo']);
    useStore.getState().tileSelectionIntoBoard(TWO_BY_TWO);

    const state = useStore.getState();
    const selected = [state.selectedObjectId, ...state.additionalSelectedIds];
    expect(selected).toHaveLength(4);
    expect(selected.every((id) => maskedPhotos().some((photo) => photo.id === id))).toBe(true);
    // The array disables Array on board, so a second click cannot stack a grid.
    expect(selectedBoardArrayDesign(state)).toBeUndefined();

    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(before);
  });

  it('keeps Fit to board to one object, and two designs out of both', () => {
    select(['photo', 'mask']);
    expect(selectedBoardFitDesign(useStore.getState())).toBeUndefined();
    select(['photo']);
    expect(selectedBoardFitDesign(useStore.getState())?.id).toBe('photo');

    // Two photos are two designs, each with its own mask.
    select(['photo']);
    useStore.getState().duplicateSelection();
    const copy = maskedPhotos().find((photo) => photo.id !== 'photo');
    if (copy === undefined) throw new Error('no duplicate');
    select(['photo', copy.id]);
    expect(selectedBoardArrayDesign(useStore.getState())).toBeUndefined();
  });
});
