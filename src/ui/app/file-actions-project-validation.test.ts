import { describe, expect, it, vi } from 'vitest';
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
});
