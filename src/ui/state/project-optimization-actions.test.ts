import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore as reset } from './test-helpers';

describe('project optimization actions', () => {
  beforeEach(() => {
    reset();
  });

  it('setProjectOptimization updates reduce travel, marks dirty, and is undoable', () => {
    useStore.setState({ dirty: false });

    useStore.getState().setProjectOptimization({ reduceTravelMoves: false });

    expect(useStore.getState().project.optimization.reduceTravelMoves).toBe(false);
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(useStore.getState().project.optimization.reduceTravelMoves).toBe(true);
  });
});
