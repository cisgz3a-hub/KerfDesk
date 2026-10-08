import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockPlatform,
  projectWithLine,
  projectWithTwoLines,
} from '../../__fixtures__/file-actions';
import { serializeProject } from '../../io/project';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { readAutosave, writeAutosave } from '../state/autosave';
import { projectAutosaveService } from '../state/autosave-durable';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import {
  handleImportDxf,
  handleImportSvg,
  handleOpenProject,
  handleSaveProject,
} from './file-actions';
import { confirmDiscardAsync } from './confirm-discard';

function saveOwner(state: ReturnType<typeof useStore.getState>) {
  return {
    expectedProject: state.project,
    projectDocumentEpoch: state.projectDocumentEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    claimProjectSaveRequest: state.claimProjectSaveRequest,
    getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
    projectSaveWriteCoordinator: state.projectSaveWriteCoordinator,
    markProjectSaveUncertain: state.markProjectSaveUncertain,
  };
}
function openOwner() {
  return {
    claimProjectOpenRequest: useStore.getState().claimProjectOpenRequest,
    getProjectOpenRequestEpoch: () => useStore.getState().projectOpenRequestEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    getProject: () => useStore.getState().project,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  localStorage.clear();
  await projectAutosaveService.session();
  resetStore();
  useConfirmSaveStore.getState().choose('cancel');
});

function addNewArtwork() {
  useStore.getState().importSvgObject(projectWithTwoLines().scene.objects[0]!);
}

describe('document ownership across file handovers', () => {
  it('keeps a newer document dirty, untitled and backed up when an older Save finishes', async () => {
    useStore.getState().setProject(projectWithLine());
    useStore.setState({ dirty: true });
    const old = useStore.getState();
    const write = deferred<undefined>();
    const target = {
      displayName: 'old-job.lf2',
      write: vi.fn((_data: string | Blob) => write.promise),
    };
    const pending = handleSaveProject({
      platform: mockPlatform(),
      project: old.project,
      ...saveOwner(old),
      savedName: null,
      lastSaveTarget: target,
      markSaved: old.markSaved,
      pushToast: vi.fn(),
    });
    useStore.getState().newProject();
    addNewArtwork();
    expect(writeAutosave(useStore.getState().project).kind).toBe('ok');
    write.resolve(undefined);
    expect(await pending).toBe('stale-document');
    expect(useStore.getState().project.scene.objects[0]?.id).toBe('A');
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().savedName).toBeNull();
    expect(useStore.getState().lastSaveTarget).toBeNull();
    expect(readAutosave()?.project.scene.objects[0]?.id).toBe('A');
    expect(target.write.mock.calls[0]?.[0]).toContain('line-1');
  });

  it('keeps same-document edits dirty and backed up while retaining the successful Save target', async () => {
    useStore.getState().setProject(projectWithLine());
    const old = useStore.getState();
    const write = deferred<undefined>();
    const target = {
      displayName: 'same-job.lf2',
      write: vi.fn((_data: string | Blob) => write.promise),
    };
    const pending = handleSaveProject({
      platform: mockPlatform(),
      project: old.project,
      ...saveOwner(old),
      savedName: null,
      lastSaveTarget: target,
      markSaved: old.markSaved,
      pushToast: vi.fn(),
    });
    addNewArtwork();
    writeAutosave(useStore.getState().project);
    write.resolve(undefined);
    expect(await pending).toBe('saved-with-newer-edits');
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().savedName).toBe('same-job.lf2');
    expect(useStore.getState().lastSaveTarget).toBe(target);
    expect(readAutosave()).not.toBeNull();
  });

  it('does not permit Save-before-New to discard edits created during the disk write', async () => {
    useStore.getState().setProject(projectWithLine());
    const write = deferred<undefined>();
    const target = {
      displayName: 'old-job.lf2',
      write: vi.fn((_data: string | Blob) => write.promise),
    };
    useStore.setState({ dirty: true, lastSaveTarget: target });
    const confirmation = confirmDiscardAsync(mockPlatform(), 'start a new project');
    useConfirmSaveStore.getState().choose('save');
    await vi.waitFor(() => expect(target.write).toHaveBeenCalledOnce());
    addNewArtwork();
    write.resolve(undefined);
    expect(await confirmation).toBe(false);
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
  });

  it('retires only this window backup after explicit discard and ignores a stale discard dialog', async () => {
    useStore.getState().setProject(projectWithLine());
    useStore.setState({ dirty: true });
    const local = writeAutosave(useStore.getState().project, 100);
    const other = writeAutosave(projectWithTwoLines(), 200, { sessionId: 'other-window' });
    expect(local.kind).toBe('ok');
    expect(other.kind).toBe('ok');
    const confirmation = confirmDiscardAsync(mockPlatform(), 'start a new project');
    useConfirmSaveStore.getState().choose('discard');
    expect(await confirmation).toBe(true);
    if (local.kind === 'ok') expect(localStorage.getItem(local.storageKey)).toBeNull();
    if (other.kind === 'ok') expect(localStorage.getItem(other.storageKey)).not.toBeNull();
    useStore.setState({ dirty: true });
    const staleConfirmation = confirmDiscardAsync(mockPlatform(), 'start a new project');
    useStore.getState().newProject();
    addNewArtwork();
    writeAutosave(useStore.getState().project, 300);
    useConfirmSaveStore.getState().choose('discard');
    expect(await staleConfirmation).toBe(false);
    expect(readAutosave()?.project.scene.objects[0]?.id).toBe('A');
  });

  it.each(['new', 'edit'] as const)(
    'does not overwrite new work after a late Open following %s',
    async (change) => {
      const read = deferred<string>();
      const readFile = vi.fn(() => read.promise);
      const pending = handleOpenProject({
        platform: mockPlatform({ open: async () => [{ name: 'old-open.lf2', text: readFile }] }),
        ...openOwner(),
        setProject: useStore.getState().setProject,
        markLoaded: useStore.getState().markLoaded,
        pushToast: vi.fn(),
      });
      await vi.waitFor(() => expect(readFile).toHaveBeenCalled());
      if (change === 'new') useStore.getState().newProject();
      addNewArtwork();
      const epoch = useStore.getState().projectDocumentEpoch;
      writeAutosave(useStore.getState().project);
      read.resolve(serializeProject(projectWithLine()));
      await pending;
      expect(useStore.getState().projectDocumentEpoch).toBe(epoch);
      expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(['A']);
      expect(useStore.getState().dirty).toBe(true);
      expect(useStore.getState().undoStack).not.toEqual([]);
      expect(useStore.getState().savedName).toBeNull();
      expect(readAutosave()).not.toBeNull();
    },
  );

  it('keeps the newer Open when two reads finish in reverse order', async () => {
    const oldRead = deferred<string>();
    const oldReadFile = vi.fn(() => oldRead.promise);
    const ctx = {
      ...openOwner(),
      setProject: useStore.getState().setProject,
      markLoaded: useStore.getState().markLoaded,
      pushToast: vi.fn(),
    };
    const oldOpen = handleOpenProject({
      ...ctx,
      platform: mockPlatform({ open: async () => [{ name: 'old.lf2', text: oldReadFile }] }),
    });
    await vi.waitFor(() => expect(oldReadFile).toHaveBeenCalled());
    await handleOpenProject({
      ...ctx,
      platform: mockPlatform({
        open: async () => [
          { name: 'new.lf2', text: async () => serializeProject(projectWithTwoLines()) },
        ],
      }),
    });
    oldRead.resolve(serializeProject(projectWithLine()));
    await oldOpen;
    expect(useStore.getState().savedName).toBe('new.lf2');
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
  });

  it.each(['picker', 'read'] as const)(
    'does not publish an SVG after New while its %s is pending',
    async (stage) => {
      const read = deferred<string>();
      const pick =
        deferred<Awaited<ReturnType<ReturnType<typeof mockPlatform>['pickFilesForOpen']>>>();
      const readFile = vi.fn(() => read.promise);
      const file = { name: 'old-import.svg', text: readFile };
      const pending = handleImportSvg(
        mockPlatform({ open: stage === 'picker' ? () => pick.promise : async () => [file] }),
        useStore.getState().importSvgObject,
        vi.fn(),
        () => useStore.getState().projectDocumentEpoch,
      );
      if (stage === 'read') await vi.waitFor(() => expect(readFile).toHaveBeenCalled());
      useStore.getState().newProject();
      addNewArtwork();
      pick.resolve([file]);
      read.resolve(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><path d="M0 0 L10 10" stroke="#000" fill="none"/></svg>',
      );
      await pending;
      expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(['A']);
    },
  );

  it('does not publish a late DXF into the new document', async () => {
    const read = deferred<string>();
    const readFile = vi.fn(() => read.promise);
    const pending = handleImportDxf(
      mockPlatform({ open: async () => [{ name: 'old.dxf', text: readFile }] }),
      useStore.getState().importSvgObject,
      vi.fn(),
      () => useStore.getState().projectDocumentEpoch,
    );
    await vi.waitFor(() => expect(readFile).toHaveBeenCalled());
    useStore.getState().newProject();
    addNewArtwork();
    read.resolve(
      [
        '0',
        'SECTION',
        '2',
        'ENTITIES',
        '0',
        'LINE',
        '10',
        '0',
        '20',
        '0',
        '11',
        '10',
        '21',
        '0',
        '0',
        'ENDSEC',
        '0',
        'EOF',
        '',
      ].join('\n'),
    );
    await pending;
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(['A']);
  });
});
