import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { confirmDiscardAsync } from './confirm-discard';

const pickSave = vi.fn(async () => null);
const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: pickSave,
  serial: { isSupported: () => false, requestPort: async () => null },
};

beforeEach(() => {
  resetStore();
  useStore.setState({ dirty: true, savedName: 'original.lf2' });
  pickSave.mockClear();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  useConfirmSaveStore.getState().choose('cancel');
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('a discard question belongs to the document it names', () => {
  it.each(['discard', 'save'] as const)(
    'an old %s choice cannot authorise discarding or saving a replacement project',
    async (choice) => {
      const pending = confirmDiscardAsync(platform, 'start a new project');
      expect(useConfirmSaveStore.getState().request?.projectName).toBe('original.lf2');
      const replacement = { ...createProject(), notes: 'A different, unsaved document' };
      useStore.getState().setProject(replacement);
      useStore.setState({ dirty: true, savedName: 'replacement.lf2' });
      const epoch = useStore.getState().projectDocumentEpoch;

      useConfirmSaveStore.getState().choose(choice);

      await expect(pending).resolves.toBe(false);
      expect(pickSave).not.toHaveBeenCalled();
      expect(useStore.getState()).toMatchObject({
        project: replacement,
        dirty: true,
        savedName: 'replacement.lf2',
        projectDocumentEpoch: epoch,
      });
      expect(useToastStore.getState().toasts).toEqual([]);
    },
  );

  it('reopening the same filename is still a different document for an old discard choice', async () => {
    const pending = confirmDiscardAsync(platform, 'open another project');
    const replacement = { ...createProject(), notes: 'Reopened with different contents' };
    useStore.getState().setProject(replacement);
    useStore.setState({ dirty: true, savedName: 'original.lf2' });
    useConfirmSaveStore.getState().choose('discard');
    await expect(pending).resolves.toBe(false);
    expect(useStore.getState().project).toBe(replacement);
    expect(useStore.getState().dirty).toBe(true);
  });

  it('New retires a question that was opened for the preceding document', async () => {
    const pending = confirmDiscardAsync(platform, 'open another project');
    useStore.getState().newProject();
    const blank = useStore.getState().project;
    useConfirmSaveStore.getState().choose('discard');
    await expect(pending).resolves.toBe(false);
    expect(useStore.getState().project).toBe(blank);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('edits within the named document still allow an explicit discard', async () => {
    const pending = confirmDiscardAsync(platform, 'start a new project');
    const before = useStore.getState().projectDocumentEpoch;
    useStore.getState().setProjectNotes('Same document edited while the question is visible');
    expect(useStore.getState().projectDocumentEpoch).toBe(before);
    useConfirmSaveStore.getState().choose('discard');
    await expect(pending).resolves.toBe(true);
    expect(pickSave).not.toHaveBeenCalled();
  });

  it('a replacement during an awaited Save survives the old captured file write', async () => {
    let finishWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const original = { ...createProject(), notes: 'Original captured contents' };
    const write = vi.fn(async (_contents: string | Blob) => writeGate);
    useStore.setState({
      project: original,
      lastSaveTarget: { displayName: 'original.lf2', write },
    });
    const pending = confirmDiscardAsync(platform, 'start a new project');
    useConfirmSaveStore.getState().choose('save');
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const replacement = { ...createProject(), notes: 'Keep the new document' };
    useStore.getState().setProject(replacement);
    useStore.setState({ dirty: true, savedName: 'replacement.lf2' });
    finishWrite();
    await expect(pending).resolves.toBe(false);
    const contents = write.mock.calls[0]![0];
    expect(
      JSON.parse(typeof contents === 'string' ? contents : await contents.text()),
    ).toMatchObject({
      notes: original.notes,
    });
    expect(useStore.getState()).toMatchObject({
      project: replacement,
      dirty: true,
      savedName: 'replacement.lf2',
    });
    expect(pickSave).not.toHaveBeenCalled();
  });

  it('Save within the named document writes its latest edits and permits New', async () => {
    const write = vi.fn(async (_contents: string | Blob) => undefined);
    useStore.setState({ lastSaveTarget: { displayName: 'original.lf2', write } });
    const pending = confirmDiscardAsync(platform, 'start a new project');
    useStore.getState().setProjectNotes('Latest edits within the same document');
    useConfirmSaveStore.getState().choose('save');
    await expect(pending).resolves.toBe(true);
    expect(write).toHaveBeenCalledOnce();
    const contents = write.mock.calls[0]![0];
    expect(
      JSON.parse(typeof contents === 'string' ? contents : await contents.text()),
    ).toMatchObject({
      notes: 'Latest edits within the same document',
    });
    expect(useStore.getState().dirty).toBe(false);
  });
});
