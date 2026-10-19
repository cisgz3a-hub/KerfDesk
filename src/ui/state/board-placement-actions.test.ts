// placeSelectionOnBoard (ADR-636): nine-point placement of the selected
// artwork on the placed board, with an edge margin, as one undoable edit.

import { beforeEach, describe, expect, it } from 'vitest';
import { transformedBBox } from '../../core/scene';
import { resetStore, svgObj } from './test-helpers';
import { useStore } from './store';

function boardAndArtworkBounds() {
  const { scene } = useStore.getState().project;
  const board = scene.objects.find((object) => object.id !== 'A');
  const art = scene.objects.find((object) => object.id === 'A');
  if (board === undefined || art === undefined) throw new Error('expected board and artwork');
  return { board: transformedBBox(board), art: transformedBBox(art) };
}

describe('placeSelectionOnBoard', () => {
  beforeEach(() => resetStore());

  it('places the artwork at each grid spot the margin in from a rectangular board', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().addCapturedBoardBox(100, 60);
    useStore.setState({ selectedObjectId: 'A', additionalSelectedIds: new Set(), undoStack: [] });

    useStore.getState().placeSelectionOnBoard('bottom-center', 5);
    let { board, art } = boardAndArtworkBounds();
    expect((art.minX + art.maxX) / 2).toBeCloseTo((board.minX + board.maxX) / 2);
    expect(art.maxY).toBeCloseTo(board.maxY - 5);

    useStore.getState().placeSelectionOnBoard('top-right', 3);
    ({ board, art } = boardAndArtworkBounds());
    expect(art.maxX).toBeCloseTo(board.maxX - 3);
    expect(art.minY).toBeCloseTo(board.minY + 3);

    useStore.getState().placeSelectionOnBoard('middle-left', 0);
    ({ board, art } = boardAndArtworkBounds());
    expect(art.minX).toBeCloseTo(board.minX);
    expect((art.minY + art.maxY) / 2).toBeCloseTo((board.minY + board.maxY) / 2);
    expect(useStore.getState().undoStack).toHaveLength(3);
  });

  it('keeps artwork inside a round board', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().addCapturedBoard({ kind: 'circle', diameterMm: 80 });
    useStore.setState({ selectedObjectId: 'A', additionalSelectedIds: new Set() });
    useStore.getState().placeSelectionOnBoard('bottom-left', 2);
    const { board, art } = boardAndArtworkBounds();
    const cx = (board.minX + board.maxX) / 2;
    const cy = (board.minY + board.maxY) / 2;
    for (const [x, y] of [
      [art.minX, art.minY],
      [art.maxX, art.minY],
      [art.minX, art.maxY],
      [art.maxX, art.maxY],
    ] as const) {
      expect(Math.hypot(x - cx, y - cy)).toBeLessThanOrEqual(40 - 2 + 1e-6);
    }
    expect(art.minX).toBeLessThan(cx - 10);
    expect(art.maxY).toBeGreaterThan(cy + 10);
  });

  it('does nothing without a board or a selection', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    const before = useStore.getState().project;
    useStore.setState({ selectedObjectId: 'A', additionalSelectedIds: new Set() });
    useStore.getState().placeSelectionOnBoard('center', 0);
    expect(useStore.getState().project).toBe(before);
    useStore.getState().addCapturedBoardBox(100, 60);
    useStore.setState({ selectedObjectId: null, additionalSelectedIds: new Set() });
    const withBoard = useStore.getState().project;
    useStore.getState().placeSelectionOnBoard('center', 0);
    expect(useStore.getState().project).toBe(withBoard);
  });
});
