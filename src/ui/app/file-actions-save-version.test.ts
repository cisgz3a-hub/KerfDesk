import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProject } from '../../core/scene';
import { deserializeProject } from '../../io/project';
import { mockPlatform, toasts } from '../../__fixtures__/file-actions';
import { useStore } from '../state';
import { clearAutosave, readAutosave, writeAutosave } from '../state/autosave';
import { handleSaveProject, SAVE_COMPLETED_WITH_NEWER_EDITS_MESSAGE } from './file-actions';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useStore.getState().newProject();
  useStore.setState({ dirty: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  clearAutosave();
  localStorage.clear();
  sessionStorage.clear();
  useStore.getState().newProject();
  useStore.setState({ dirty: false });
});

describe('project save version binding', () => {
  it('keeps newer edits dirty and recoverable when an older disk write finishes', async () => {
    const captured = { ...createProject(), notes: 'captured by save' };
    useStore.setState({ project: captured, dirty: true });
    let finishWrite = (): void => undefined;
    const writeGate = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    let fileJson = '';
    const write = vi.fn(async (value: string | Blob) => {
      if (typeof value !== 'string') throw new Error('Expected project JSON text.');
      fileJson = value;
      await writeGate;
    });
    const toast = toasts();
    const saving = handleSaveProject({
      platform: mockPlatform({
        save: async () => ({ displayName: 'versioned.lf2', write }),
      }),
      project: captured,
      savedName: null,
      lastSaveTarget: null,
      markSaved: useStore.getState().markSaved,
      pushToast: toast.pushToast,
    });
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());

    const edited = { ...captured, notes: 'edited while disk write pending' };
    useStore.setState({ project: edited, dirty: true });
    expect(writeAutosave(edited, 200).kind).toBe('ok');
    finishWrite();

    await expect(saving).resolves.toBe('saved-with-newer-edits');
    const file = deserializeProject(fileJson);
    expect(file.kind).toBe('ok');
    expect(file.kind === 'ok' ? file.project.notes : null).toBe('captured by save');
    expect(useStore.getState()).toMatchObject({
      project: { notes: 'edited while disk write pending' },
      dirty: true,
      savedName: 'versioned.lf2',
    });
    expect(readAutosave()?.project.notes).toBe('edited while disk write pending');
    expect(toast.messages).toContainEqual({
      message: SAVE_COMPLETED_WITH_NEWER_EDITS_MESSAGE,
      variant: 'warning',
    });
  });
});
