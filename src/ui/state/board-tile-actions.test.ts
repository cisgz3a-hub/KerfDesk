// Tests for tileSelectionIntoBoard (ADR-125 A2) — the store action that tiles
// copies of the single selected design across the placed board.

import { beforeEach, describe, expect, it } from 'vitest';
import { findRegistrationBoxes, transformedBBox } from '../../core/scene';
import { resetStore, svgObj } from './test-helpers';
import { useStore } from './store';

const ART_SIDE_MM = 10; // svgObj bounds are 0..10 in both axes

function boardId(): string {
  const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
  if (box === undefined) throw new Error('expected a placed board');
  return box.id;
}

function designCount(boxId: string): number {
  return useStore.getState().project.scene.objects.filter((o) => o.id !== boxId).length;
}

describe('tileSelectionIntoBoard', () => {
  beforeEach(() => resetStore());

  it('tiles the selected design into a grid, as one undoable edit', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().addCapturedBoardBox(100, 60);
    const box = boardId();
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(),
      undoStack: [],
      dirty: false,
    });

    useStore
      .getState()
      .tileSelectionIntoBoard({ kind: 'grid', rows: 2, cols: 2, gapXMm: 0, gapYMm: 0 });

    const after = useStore.getState();
    expect(designCount(box)).toBe(4); // original moved into slot 0 + 3 fresh copies
    expect(after.undoStack).toHaveLength(1);
    expect(after.dirty).toBe(true);
    // still exactly one board — copies never duplicate the registration box
    expect(findRegistrationBoxes(after.project.scene)).toHaveLength(1);

    useStore.getState().undo();
    expect(designCount(box)).toBe(1);
  });

  it('selects the whole array after tiling so a re-click cannot silently stack', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().addCapturedBoardBox(100, 60);
    const box = boardId();
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(),
      undoStack: [],
      dirty: false,
    });

    useStore
      .getState()
      .tileSelectionIntoBoard({ kind: 'grid', rows: 2, cols: 2, gapXMm: 0, gapYMm: 0 });

    const after = useStore.getState();
    const selected = new Set(
      [after.selectedObjectId, ...after.additionalSelectedIds].filter(
        (id): id is string => id !== null,
      ),
    );
    const designIds = after.project.scene.objects.filter((o) => o.id !== box).map((o) => o.id);
    expect(selected.size).toBe(4); // the whole grid is selected → Array/Fit disable
    for (const id of designIds) expect(selected.has(id)).toBe(true);
  });

  it('does not stack a second grid when re-arrayed without deselecting', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().addCapturedBoardBox(100, 60);
    const box = boardId();
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(),
      undoStack: [],
      dirty: false,
    });
    const layout = { kind: 'grid', rows: 2, cols: 2, gapXMm: 0, gapYMm: 0 } as const;

    useStore.getState().tileSelectionIntoBoard(layout);
    const afterFirst = designCount(box);
    useStore.getState().tileSelectionIntoBoard(layout); // whole array still selected → no-op

    expect(designCount(box)).toBe(afterFirst); // no doubled / overlapping copies
  });

  it('fills the board with as many copies as fit', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().addCapturedBoardBox(50, 50);
    const boxObj = findRegistrationBoxes(useStore.getState().project.scene)[0];
    if (boxObj === undefined) throw new Error('expected a placed board');
    const box = boxObj.id;
    const region = transformedBBox(boxObj);
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(),
      undoStack: [],
      dirty: false,
    });

    useStore.getState().tileSelectionIntoBoard({ kind: 'fill', gapXMm: 0, gapYMm: 0 });

    const perAxisX = Math.max(1, Math.floor((region.maxX - region.minX) / ART_SIDE_MM));
    const perAxisY = Math.max(1, Math.floor((region.maxY - region.minY) / ART_SIDE_MM));
    expect(designCount(box)).toBe(perAxisX * perAxisY);
    expect(designCount(box)).toBeGreaterThan(1);
  });

  it('does nothing when no board is placed', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.setState({ selectedObjectId: 'A', undoStack: [], dirty: false });
    const before = useStore.getState().project.scene.objects.length;

    useStore
      .getState()
      .tileSelectionIntoBoard({ kind: 'grid', rows: 2, cols: 2, gapXMm: 0, gapYMm: 0 });

    const after = useStore.getState();
    expect(after.project.scene.objects.length).toBe(before);
    expect(after.undoStack).toHaveLength(0);
    expect(after.dirty).toBe(false);
  });

  it('does nothing when more than one design is selected', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));
    useStore.getState().addCapturedBoardBox(100, 60);
    const box = boardId();
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(['B']),
      undoStack: [],
      dirty: false,
    });

    useStore
      .getState()
      .tileSelectionIntoBoard({ kind: 'grid', rows: 2, cols: 2, gapXMm: 0, gapYMm: 0 });

    expect(designCount(box)).toBe(2); // A and B untouched, no copies
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
