import { describe, expect, it, vi } from 'vitest';
import { projectSaveRequestEpochCallbacks } from '../../__fixtures__/file-actions';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject, type Project } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { handleSaveProject } from './file-actions';
import { jobAwareConfirm } from '../state/job-aware-dialogs';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareConfirm: vi.fn(() => false),
  jobAwareAlert: vi.fn(),
}));

const mockConfirm = vi.mocked(jobAwareConfirm);

describe('project save validation', () => {
  it('rejects invalid live project state before opening the save picker', async () => {
    mockConfirm.mockReturnValue(false);
    const pickFileForSave = vi.fn(async () => null);
    const pushToast = vi.fn();
    const project = {
      ...createProject(),
      workspace: { ...createProject().workspace, width: Number.NaN },
    } as Project;
    const platform = {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave,
      serial: { isSupported: () => false, requestPort: async () => null },
    } satisfies PlatformAdapter;

    await expect(
      handleSaveProject({
        platform,
        project,
        expectedProject: project,
        projectDocumentEpoch: 0,
        getProjectDocumentEpoch: () => 0,
        ...projectSaveRequestEpochCallbacks(),
        savedName: null,
        lastSaveTarget: null,
        markSaved: vi.fn(),
        pushToast,
      }),
    ).resolves.toBe('error');

    expect(pickFileForSave).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Could not save project: missing or invalid `workspace.width`',
      'error',
    );
  });

  it('does not mark a project saved when CNC safety values would be normalized', async () => {
    mockConfirm.mockReturnValue(false);
    const pickFileForSave = vi.fn(async () => null);
    const markSaved = vi.fn();
    const pushToast = vi.fn();
    const project = {
      ...createProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: Number.NaN },
      },
    } as Project;
    const platform = {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave,
      serial: { isSupported: () => false, requestPort: async () => null },
    } satisfies PlatformAdapter;

    await expect(
      handleSaveProject({
        platform,
        project,
        expectedProject: project,
        projectDocumentEpoch: 0,
        getProjectDocumentEpoch: () => 0,
        ...projectSaveRequestEpochCallbacks(),
        savedName: null,
        lastSaveTarget: null,
        markSaved,
        pushToast,
      }),
    ).resolves.toBe('error');

    expect(pickFileForSave).not.toHaveBeenCalled();
    expect(markSaved).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Could not save project: saving would change `machine.params.safeZMm` during validation; repair or reload the project before saving',
      'error',
    );
  });

  it('offers a raw recovery export when save is refused and the operator accepts (A7)', async () => {
    mockConfirm.mockReturnValue(true);
    const write = vi.fn(async () => undefined);
    const target: SaveTarget = { displayName: 'untitled-recovery.lf2', write };
    const pickFileForSave = vi.fn(async () => target);
    const markSaved = vi.fn();
    const pushToast = vi.fn();
    const project = {
      ...createProject(),
      workspace: { ...createProject().workspace, width: Number.NaN },
    } as Project;
    const platform = {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave,
      serial: { isSupported: () => false, requestPort: async () => null },
    } satisfies PlatformAdapter;

    // The canonical save still fails — salvage never counts as a clean save.
    await expect(
      handleSaveProject({
        platform,
        project,
        expectedProject: project,
        projectDocumentEpoch: 0,
        getProjectDocumentEpoch: () => 0,
        ...projectSaveRequestEpochCallbacks(),
        savedName: null,
        lastSaveTarget: null,
        markSaved,
        pushToast,
      }),
    ).resolves.toBe('error');

    expect(pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'untitled-recovery.lf2',
      extensions: ['.lf2'],
    });
    expect(write).toHaveBeenCalledOnce();
    expect(markSaved).not.toHaveBeenCalled();
  });

  it('reports when a late older recovery write cannot restore the newest recovery bytes', async () => {
    mockConfirm.mockReturnValue(true);
    const firstPicker = deferred<SaveTarget | null>();
    const writtenNotes: string[] = [];
    const target: SaveTarget = {
      displayName: 'shared-recovery.lf2',
      write: vi.fn(async (value) => {
        writtenNotes.push(noteFromRawRecovery(value));
        if (writtenNotes.length === 3) throw new Error('restore disk failure');
      }),
    };
    const owners = projectSaveRequestEpochCallbacks();
    const firstToast = vi.fn();
    const secondToast = vi.fn();
    const firstProject = invalidProject('older recovery');
    const firstPick = vi.fn(async () => firstPicker.promise);
    const first = handleSaveProject({
      platform: recoveryPlatform(firstPick),
      project: firstProject,
      expectedProject: firstProject,
      projectDocumentEpoch: 0,
      getProjectDocumentEpoch: () => 0,
      ...owners,
      savedName: null,
      lastSaveTarget: null,
      markSaved: vi.fn(),
      pushToast: firstToast,
    });
    await vi.waitFor(() => expect(firstPick).toHaveBeenCalledOnce());

    const secondProject = invalidProject('newest recovery');
    await expect(
      handleSaveProject({
        platform: recoveryPlatform(async () => target),
        project: secondProject,
        expectedProject: secondProject,
        projectDocumentEpoch: 0,
        getProjectDocumentEpoch: () => 0,
        ...owners,
        savedName: null,
        lastSaveTarget: null,
        markSaved: vi.fn(),
        pushToast: secondToast,
      }),
    ).resolves.toBe('error');

    firstPicker.resolve(target);
    await expect(first).resolves.toBe('error');
    await vi.waitFor(() => {
      expect(writtenNotes).toEqual(['newest recovery', 'older recovery', 'newest recovery']);
      expect(secondToast).toHaveBeenCalledWith(
        expect.stringContaining('That recovery copy is unreliable; export it again.'),
        'error',
      );
    });
  });
});

function invalidProject(notes: string): Project {
  const project = createProject();
  return {
    ...project,
    notes,
    workspace: { ...project.workspace, width: Number.NaN },
  } as Project;
}

function recoveryPlatform(pickFileForSave: PlatformAdapter['pickFileForSave']): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

function noteFromRawRecovery(value: string | Blob): string {
  if (typeof value !== 'string') throw new Error('Expected raw recovery text.');
  const parsed = JSON.parse(value) as { readonly notes?: unknown };
  if (typeof parsed.notes !== 'string') throw new Error('Expected recovery notes.');
  return parsed.notes;
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}
