import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore as reset, svgObj } from './test-helpers';

describe('scene group actions', () => {
  beforeEach(() => reset());

  it('groups the current selection as one undoable dirty edit', () => {
    seedThreeObjects();
    useStore.getState().selectObjects(['O1', 'O2']);
    useStore.setState({ dirty: false, undoStack: [] });

    useStore.getState().groupSelection();

    const state = useStore.getState();
    const groups = state.project.scene.groups ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.objectIds).toEqual(['O1', 'O2']);
    expect(state.selectedObjectId).toBe('O1');
    expect([...state.additionalSelectedIds]).toEqual(['O2']);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it('does not create a group for a single selected object', () => {
    seedThreeObjects();
    useStore.getState().selectObject('O1');

    useStore.getState().groupSelection();

    expect(useStore.getState().project.scene.groups).toEqual([]);
  });

  it('selecting a grouped member selects the whole group', () => {
    seedThreeObjects();
    useStore.getState().selectObjects(['O1', 'O2']);
    useStore.getState().groupSelection();

    useStore.getState().selectObject('O2');

    expect(useStore.getState().selectedObjectId).toBe('O1');
    expect([...useStore.getState().additionalSelectedIds]).toEqual(['O2']);
  });

  it('ungroups every group touched by the current selection', () => {
    seedThreeObjects();
    useStore.getState().selectObjects(['O1', 'O2']);
    useStore.getState().groupSelection();
    useStore.setState({ dirty: false, undoStack: [] });

    useStore.getState().selectObject('O2');
    useStore.getState().ungroupSelection();

    const state = useStore.getState();
    expect(state.project.scene.groups).toEqual([]);
    expect(state.selectedObjectId).toBe('O1');
    expect([...state.additionalSelectedIds]).toEqual(['O2']);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it('deleting grouped objects prunes group membership', () => {
    seedThreeObjects();
    useStore.getState().selectObjects(['O1', 'O2', 'O3']);
    useStore.getState().groupSelection();

    useStore.getState().removeSceneObject('O3');

    expect(useStore.getState().project.scene.groups).toEqual([
      expect.objectContaining({ objectIds: ['O1', 'O2'] }),
    ]);
  });
});

function seedThreeObjects(): void {
  useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
  useStore.getState().importSvgObject(svgObj('O2', ['#00ff00']));
  useStore.getState().importSvgObject(svgObj('O3', ['#0000ff']));
}
