import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform, projectWithLine } from '../../__fixtures__/file-actions';
import type { StreamerState } from '../../core/controllers/grbl';
import { serializeProject } from '../../io/project';
import { saveProjectNow } from '../app/confirm-discard';
import { useStore } from '../state';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import type { LocalProjectSnapshot } from './local-project-snapshot';
import type { LocalSnapshotStorage } from './local-snapshot-storage';
import { restoreLocalSnapshot } from './restore-local-snapshot';

vi.mock('../app/autosave-file-cleanup', () => ({ clearAutosaveAfterFileHandoff: vi.fn() }));

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  useConfirmSaveStore.setState({ request: null });
});

function snapshot(): LocalProjectSnapshot {
  const project = { ...projectWithLine(), notes: 'Resume at material test' };
  const projectJson = serializeProject(project);
  return {
    version: 1,
    id: 'copy',
    name: 'Cut settings',
    notesExcerpt: project.notes,
    bytes: new TextEncoder().encode(projectJson).byteLength,
    createdAt: 1,
    projectJson,
  };
}
function storage(read = vi.fn(async () => snapshot())): LocalSnapshotStorage {
  return { list: async () => [], read, add: vi.fn(), remove: vi.fn() };
}

describe('restore local snapshot as a new project', () => {
  it('replaces the document through normal admission and first Save chooses a new file', async () => {
    const oldWrite = vi.fn();
    useStore.setState({
      savedName: 'original.lf2',
      lastSaveTarget: { displayName: 'original.lf2', write: oldWrite },
    });
    const epoch = useStore.getState().projectDocumentEpoch;
    const newWrite = vi.fn(async () => undefined);
    const pickFileForSave = vi.fn(async () => ({ displayName: 'restored.lf2', write: newWrite }));
    const platform = { ...mockPlatform(), pickFileForSave };
    expect(await restoreLocalSnapshot(platform, storage(), 'copy', vi.fn())).toBe(true);
    expect(useStore.getState()).toMatchObject({
      dirty: true,
      projectDocumentEpoch: epoch + 1,
      savedName: 'Cut settings - restored.lf2',
      lastSaveTarget: null,
    });
    expect(useStore.getState().project.notes).toBe('Resume at material test');
    expect(await saveProjectNow(platform)).toBe('saved');
    expect(pickFileForSave).toHaveBeenCalledOnce();
    expect(newWrite).toHaveBeenCalledOnce();
    expect(oldWrite).not.toHaveBeenCalled();
  });

  it('honours Cancel without reading the snapshot or replacing current work', async () => {
    useStore.setState({ dirty: true });
    const before = useStore.getState().project;
    const source = storage();
    const pending = restoreLocalSnapshot(mockPlatform(), source, 'copy', vi.fn());
    expect(useConfirmSaveStore.getState().request?.action).toContain('new project');
    useConfirmSaveStore.getState().choose('cancel');
    expect(await pending).toBe(false);
    expect(source.read).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(before);
  });

  it.each(['replacement', 'newer request', 'edit'] as const)(
    'does not overwrite a %s during storage reads',
    async (change) => {
      let resolve!: (value: LocalProjectSnapshot) => void;
      const read = vi.fn(
        () =>
          new Promise<LocalProjectSnapshot>((done) => {
            resolve = done;
          }),
      );
      const toast = vi.fn();
      const pending = restoreLocalSnapshot(mockPlatform(), storage(read), 'copy', toast);
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      if (change === 'replacement') useStore.getState().newProject();
      if (change === 'newer request') useStore.getState().claimProjectOpenRequest();
      if (change === 'edit') useStore.getState().setProjectNotes('New notes');
      const current = useStore.getState().project;
      resolve(snapshot());
      expect(await pending).toBe(false);
      expect(useStore.getState().project).toBe(current);
      if (change === 'edit')
        expect(toast).toHaveBeenCalledWith(expect.stringContaining('project changed'), 'warning');
    },
  );

  it('keeps an owned active job and document untouched without reading or sending commands', async () => {
    useLaserStore.setState({ streamer: { status: 'paused' } as StreamerState });
    const before = useStore.getState().project;
    const source = storage();
    expect(await restoreLocalSnapshot(mockPlatform(), source, 'copy', vi.fn())).toBe(false);
    expect(source.read).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(before);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
  });
});
