import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { confirmDiscardAsync } from './confirm-discard';
import { projectAutosaveService, type AutosaveDurableClearResult } from '../state/autosave-durable';

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
  vi.restoreAllMocks();
  useConfirmSaveStore.getState().choose('cancel');
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('a discard question belongs to the document it names', () => {
  it('waits for owned recovery cleanup before allowing New', async () => {
    let finish!: (result: AutosaveDurableClearResult) => void;
    const clear = vi.spyOn(projectAutosaveService, 'clearCurrent').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const original = useStore.getState().project;
    const pending = confirmDiscardAsync(platform, 'start a new project');
    useConfirmSaveStore.getState().choose('discard');
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce());
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(useStore.getState().project).toBe(original);
    finish({ kind: 'ok' });
    if (await pending) useStore.getState().newProject();
    expect(useStore.getState().project).not.toBe(original);
    expect(useStore.getState().dirty).toBe(false);
  });

  it.each(['edit', 'replacement'] as const)(
    'keeps a %s made while discard cleanup is pending',
    async (change) => {
      let finish!: (result: AutosaveDurableClearResult) => void;
      const clear = vi.spyOn(projectAutosaveService, 'clearCurrent').mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = confirmDiscardAsync(platform, 'start a new project');
      useConfirmSaveStore.getState().choose('discard');
      await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce());
      if (change === 'replacement') useStore.getState().setProject(createProject());
      useStore.getState().setProjectNotes('Work created after choosing discard');
      const latest = useStore.getState().project;
      finish({ kind: 'ok' });
      if (await pending) useStore.getState().newProject();
      expect(useStore.getState().project).toBe(latest);
      expect(useStore.getState().dirty).toBe(true);
    },
  );

  it('warns on failed owned cleanup but still permits an unchanged explicit discard', async () => {
    vi.spyOn(projectAutosaveService, 'clearCurrent').mockResolvedValue({
      kind: 'failed',
      error: new Error('storage unavailable'),
    });
    const pending = confirmDiscardAsync(platform, 'start a new project');
    useConfirmSaveStore.getState().choose('discard');
    await expect(pending).resolves.toBe(true);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.variant).toBe('warning');
  });

  it('does not publish an old cleanup warning into a replacement document', async () => {
    let finish!: (result: AutosaveDurableClearResult) => void;
    const clear = vi.spyOn(projectAutosaveService, 'clearCurrent').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = confirmDiscardAsync(platform, 'start a new project');
    useConfirmSaveStore.getState().choose('discard');
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce());
    useStore.getState().newProject();
    finish({ kind: 'failed', error: new Error('old cleanup failed') });
    await expect(pending).resolves.toBe(false);
    expect(useToastStore.getState().toasts).toEqual([]);
  });
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
