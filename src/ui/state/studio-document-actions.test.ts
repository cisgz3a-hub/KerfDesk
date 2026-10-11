import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as validator from '../../io/project/project-studio-document-validator';
import { studioDocument } from '../../io/project/studio-document.test-fixture';
import { deserializeProject, serializeProject } from '../../io/project';
import { createAutosaveProjectSnapshot } from './autosave-project-snapshot';
import { resetStore } from './test-helpers';
import { useStore } from './store';

beforeEach(resetStore);
afterEach(() => vi.restoreAllMocks());
describe('project-owned native studio documents', () => {
  it('accepts unchanged checkpoints before scanning source or parsing inactive sheets', () => {
    const initial = studioDocument();
    useStore.getState().upsertStudioDocument(initial, 0);
    const check = vi.spyOn(validator, 'validateProjectStudioDocuments');
    const before = useStore.getState();
    expect(before.upsertStudioDocument({ ...initial, revision: 'next-checkpoint' }, 0)).toBe(true);
    expect(check).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    before.upsertStudioDocument({ ...initial, title: 'Changed title' }, 0);
    expect(check).toHaveBeenCalledTimes(1);
  });
  it('upserts one stable identity, tracks dirty/history and restores native revisions on Undo', () => {
    const initial = studioDocument();
    expect(useStore.getState().upsertStudioDocument(initial, 0)).toBe(true);
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().upsertStudioDocument({ ...initial }, 0)).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.setState({ dirty: false });
    useStore
      .getState()
      .upsertStudioDocument({ ...initial, revision: 'same-bytes-new-checkpoint' }, 0);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().project.studioDocuments).toEqual([initial]);
    const revised = { ...initial, revision: 'revision-two', title: 'Revised artwork' };
    useStore.getState().upsertStudioDocument(revised, 0);
    expect(useStore.getState().project.studioDocuments).toEqual([revised]);
    useStore.getState().undo();
    expect(useStore.getState().project.studioDocuments).toEqual([initial]);
    useStore.getState().redo();
    expect(useStore.getState().project.studioDocuments).toEqual([revised]);
  });

  it('retains source in autosave snapshots and reopened files, while New clears it', () => {
    const native = studioDocument();
    useStore.getState().upsertStudioDocument(native, 0);
    const snapshot = createAutosaveProjectSnapshot()(useStore.getState());
    expect(snapshot.studioDocuments).toEqual([native]);
    const read = deserializeProject(serializeProject(snapshot));
    if (read.kind !== 'ok') throw new Error('Roundtrip failed');
    useStore.getState().newProject();
    expect(useStore.getState().project.studioDocuments).toBeUndefined();
    expect(useStore.getState().upsertStudioDocument(native, 0)).toBe(false);
    useStore.getState().setProject(read.project);
    expect(useStore.getState().project.studioDocuments).toEqual([native]);
    expect(useStore.getState().upsertStudioDocument({ ...native, title: 'stale' }, 1)).toBe(false);
  });

  it('rejects invalid native metadata without replacing current source or dirty/history', () => {
    const before = useStore.getState();
    expect(() =>
      before.upsertStudioDocument(studioDocument({ nativeBase64: 'not base64' }), 0),
    ).toThrow('nativeBase64');
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
