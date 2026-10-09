import { beforeEach, describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';

describe('project sheet naming ownership', () => {
  beforeEach(resetStore);
  it('can rename the initial sheet and retain the name through add, undo and save/reopen', () => {
    const initial = useStore.getState().project;
    useStore.getState().renameProjectSheet('current', 'Carving face');
    const named = useStore.getState().project;
    expect(named.sheetBook?.activeName).toBe('Carving face');
    expect(named.scene).toBe(initial.scene);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(initial);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(named);
    const copy = useStore.getState().addProjectSheet('Back face', true);
    expect(copy).not.toBeNull();
    expect(useStore.getState().project.sheetBook?.inactive[0]?.name).toBe('Carving face');
    const reopened = deserializeProject(serializeProject(useStore.getState().project));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind === 'ok')
      expect(reopened.project.sheetBook?.inactive[0]?.name).toBe('Carving face');
  });
  it('keeps no-op, empty and unknown names out of dirty state and undo history', () => {
    useStore.getState().renameProjectSheet('current', 'Sheet 1');
    expect(useStore.getState().project.sheetBook).toBeUndefined();
    expect(useStore.getState().dirty).toBe(false);
    useStore.getState().renameProjectSheet('current', 'Carving face');
    useStore.setState({ dirty: false });
    const state = useStore.getState();
    const id = state.project.sheetBook?.activeId ?? '';
    for (const [target, name] of [
      [id, ' Carving face '],
      [id, ''],
      ['missing', 'Other'],
    ]) {
      useStore.getState().renameProjectSheet(target ?? '', name ?? '');
      expect(useStore.getState().project).toBe(state.project);
      expect(useStore.getState().undoStack).toBe(state.undoStack);
      expect(useStore.getState().dirty).toBe(false);
    }
  });
});
