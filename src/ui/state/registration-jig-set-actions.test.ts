import { beforeEach, describe, expect, it } from 'vitest';
import { findRegistrationBoxBounds, findRegistrationBoxes } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const FIVE_JIGS = {
  outline: { kind: 'rectangle', widthMm: 40, heightMm: 30 },
  rows: 1,
  columns: 5,
  spacingX: 10,
  spacingY: 0,
} as const;

describe('registration jig set actions', () => {
  beforeEach(() => resetStore());

  it('creates five registered outlines as one centered row and one undo step', () => {
    useStore.getState().replaceRegistrationJigSet(FIVE_JIGS);

    const state = useStore.getState();
    const boxes = findRegistrationBoxes(state.project.scene);
    expect(boxes).toHaveLength(5);
    expect(boxes.map((box) => box.transform.x)).toEqual([80, 130, 180, 230, 280]);
    expect(boxes.every((box) => box.transform.y === 185)).toBe(true);
    expect(state.selectedObjectId).toBe(boxes[0]?.id);
    expect(state.additionalSelectedIds).toEqual(new Set(boxes.slice(1).map((box) => box.id)));
    expect(state.undoStack).toHaveLength(1);
  });

  it('replaces a set at the same fixture origin and carries its all-locked state', () => {
    useStore.getState().replaceRegistrationJigSet({ ...FIVE_JIGS, columns: 2 });
    useStore.getState().nudgeSelection(12, 8);
    useStore.getState().setRegistrationBoxLocked(true);
    const before = findRegistrationBoxBounds(useStore.getState().project.scene);

    useStore.getState().replaceRegistrationJigSet(FIVE_JIGS);

    const state = useStore.getState();
    const boxes = findRegistrationBoxes(state.project.scene);
    const after = findRegistrationBoxBounds(state.project.scene);
    expect(after?.minX).toBe(before?.minX);
    expect(after?.minY).toBe(before?.minY);
    expect(boxes).toHaveLength(5);
    expect(boxes.every((box) => box.locked === true)).toBe(true);
  });

  it('does not replace a captured-board outline through the jig-set action', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    const before = useStore.getState().project;

    useStore.getState().replaceRegistrationJigSet(FIVE_JIGS);

    expect(useStore.getState().project).toBe(before);
    expect(findRegistrationBoxes(before.scene)).toHaveLength(1);
  });
});
