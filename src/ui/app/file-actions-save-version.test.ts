import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProject } from '../../core/scene';
import { deserializeProject } from '../../io/project';
import { mockPlatform, toasts } from '../../__fixtures__/file-actions';
import { useStore } from '../state';
import { clearAutosave, readAutosave, writeAutosave } from '../state/autosave';
import { handleSaveProject, SAVE_COMPLETED_WITH_NEWER_EDITS_MESSAGE } from './file-actions';

const getProjectDocumentEpoch = (): number => useStore.getState().projectDocumentEpoch;
const getProjectSaveRequestEpoch = (): number => useStore.getState().projectSaveRequestEpoch;

function saveRequestOwner() {
  return {
    claimProjectSaveRequest: useStore.getState().claimProjectSaveRequest,
    getProjectSaveRequestEpoch,
    projectSaveWriteCoordinator: useStore.getState().projectSaveWriteCoordinator,
    markProjectSaveUncertain: useStore.getState().markProjectSaveUncertain,
  };
}

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
  it('marks the live project clean when a derived persistence snapshot reaches disk', async () => {
    const live = { ...createProject(), notes: 'live project' };
    const persisted = { ...live };
    useStore.setState({ project: live, dirty: true });
    const target = { displayName: 'derived.lf2', write: vi.fn(async () => undefined) };

    await expect(
      handleSaveProject({
        platform: mockPlatform({ save: async () => target }),
        project: persisted,
        expectedProject: live,
        projectDocumentEpoch: useStore.getState().projectDocumentEpoch,
        getProjectDocumentEpoch,
        ...saveRequestOwner(),
        savedName: null,
        lastSaveTarget: null,
        markSaved: useStore.getState().markSaved,
        pushToast: toasts().pushToast,
      }),
    ).resolves.toBe('saved');
    expect(useStore.getState().dirty).toBe(false);
  });

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
    const target = { displayName: 'versioned.lf2', write };
    const toast = toasts();
    const saving = handleSaveProject({
      platform: mockPlatform({
        save: async () => target,
      }),
      project: captured,
      expectedProject: captured,
      projectDocumentEpoch: useStore.getState().projectDocumentEpoch,
      getProjectDocumentEpoch,
      ...saveRequestOwner(),
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
      lastSaveTarget: target,
    });
    expect(readAutosave()?.project.notes).toBe('edited while disk write pending');
    expect(toast.messages).toContainEqual({
      message: SAVE_COMPLETED_WITH_NEWER_EDITS_MESSAGE,
      variant: 'warning',
    });
  });

  it('does not publish an earlier Save target into a replacement New document', async () => {
    const captured = { ...createProject(), notes: 'document A' };
    useStore.setState({ project: captured, dirty: true });
    let finishWrite = (): void => undefined;
    const writeGate = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const target = { displayName: 'document-a.lf2', write: vi.fn(async () => writeGate) };
    const toast = toasts();
    const saving = handleSaveProject({
      platform: mockPlatform({ save: async () => target }),
      project: captured,
      expectedProject: captured,
      projectDocumentEpoch: useStore.getState().projectDocumentEpoch,
      getProjectDocumentEpoch,
      ...saveRequestOwner(),
      savedName: null,
      lastSaveTarget: null,
      markSaved: useStore.getState().markSaved,
      pushToast: toast.pushToast,
    });
    await vi.waitFor(() => expect(target.write).toHaveBeenCalledOnce());

    useStore.getState().newProject();
    const replacement = { ...useStore.getState().project, notes: 'document B recovery' };
    useStore.setState({ project: replacement, dirty: true });
    expect(writeAutosave(replacement, 300).kind).toBe('ok');
    finishWrite();

    await expect(saving).resolves.toBe('stale-document');
    expect(useStore.getState()).toMatchObject({
      project: { notes: 'document B recovery' },
      dirty: true,
      savedName: null,
      lastSaveTarget: null,
    });
    expect(readAutosave()?.project.notes).toBe('document B recovery');
    expect(toast.messages).toEqual([]);
  });

  it('keeps an opened document owner and prompts instead of reusing a stale Save target', async () => {
    const captured = { ...createProject(), notes: 'document A' };
    useStore.setState({ project: captured, dirty: true });
    let finishWrite = (): void => undefined;
    const writeGate = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const staleTarget = {
      displayName: 'document-a.lf2',
      write: vi.fn(async () => writeGate),
    };
    const toast = toasts();
    const saving = handleSaveProject({
      platform: mockPlatform({ save: async () => staleTarget }),
      project: captured,
      expectedProject: captured,
      projectDocumentEpoch: useStore.getState().projectDocumentEpoch,
      getProjectDocumentEpoch,
      ...saveRequestOwner(),
      savedName: null,
      lastSaveTarget: null,
      markSaved: useStore.getState().markSaved,
      pushToast: toast.pushToast,
    });
    await vi.waitFor(() => expect(staleTarget.write).toHaveBeenCalledOnce());

    const opened = { ...createProject(), notes: 'opened document B' };
    useStore.getState().setProject(opened);
    useStore.getState().markLoaded('opened-b.lf2');
    finishWrite();

    await expect(saving).resolves.toBe('stale-document');
    expect(useStore.getState()).toMatchObject({
      project: { notes: 'opened document B' },
      dirty: false,
      savedName: 'opened-b.lf2',
      lastSaveTarget: null,
    });
    expect(toast.messages).toEqual([]);

    const replacementTarget = {
      displayName: 'opened-b-saved.lf2',
      write: vi.fn(async () => undefined),
    };
    const pickReplacementTarget = vi.fn(async () => replacementTarget);
    const state = useStore.getState();
    await expect(
      handleSaveProject({
        platform: mockPlatform({ save: pickReplacementTarget }),
        project: state.project,
        expectedProject: state.project,
        projectDocumentEpoch: state.projectDocumentEpoch,
        getProjectDocumentEpoch,
        ...saveRequestOwner(),
        savedName: state.savedName,
        lastSaveTarget: state.lastSaveTarget,
        markSaved: state.markSaved,
        pushToast: toasts().pushToast,
      }),
    ).resolves.toBe('saved');
    expect(pickReplacementTarget).toHaveBeenCalledOnce();
    expect(staleTarget.write).toHaveBeenCalledOnce();
    expect(replacementTarget.write).toHaveBeenCalledOnce();
  });

  it.each(['New', 'Open'] as const)(
    'keeps a late write failure silent after a replacement %s',
    async (replacementKind) => {
      const captured = { ...createProject(), notes: 'document A' };
      useStore.setState({ project: captured, dirty: true });
      let failWrite = (_error: Error): void => undefined;
      const writeGate = new Promise<void>((_resolve, reject) => {
        failWrite = reject;
      });
      const target = { displayName: 'document-a.lf2', write: vi.fn(async () => writeGate) };
      const toast = toasts();
      const saving = handleSaveProject({
        platform: mockPlatform({ save: async () => target }),
        project: captured,
        expectedProject: captured,
        projectDocumentEpoch: useStore.getState().projectDocumentEpoch,
        getProjectDocumentEpoch,
        ...saveRequestOwner(),
        savedName: null,
        lastSaveTarget: null,
        markSaved: useStore.getState().markSaved,
        pushToast: toast.pushToast,
      });
      await vi.waitFor(() => expect(target.write).toHaveBeenCalledOnce());

      if (replacementKind === 'New') {
        useStore.getState().newProject();
      } else {
        useStore.getState().setProject({ ...createProject(), notes: 'opened document B' });
        useStore.getState().markLoaded('opened-b.lf2');
      }
      const replacement = useStore.getState();
      failWrite(new Error('late disk failure'));

      await expect(saving).resolves.toBe('stale-document');
      expect(useStore.getState()).toMatchObject({
        project: replacement.project,
        dirty: replacement.dirty,
        savedName: replacement.savedName,
        lastSaveTarget: replacement.lastSaveTarget,
      });
      expect(toast.messages).toEqual([]);
    },
  );
});
