import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore as reset } from './test-helpers';

describe('project notes actions', () => {
  beforeEach(() => {
    reset();
  });

  it('setProjectNotes updates notes, marks dirty, and is undoable', () => {
    useStore.setState({ dirty: false });

    useStore.getState().setProjectNotes('Material: birch\nAir assist on');

    expect(useStore.getState().project.notes).toBe('Material: birch\nAir assist on');
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(useStore.getState().project.notes).toBe('');
  });
});
