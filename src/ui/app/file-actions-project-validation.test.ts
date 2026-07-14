import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject, type Project } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { handleSaveProject } from './file-actions';

describe('project save validation', () => {
  it('rejects invalid live project state before opening the save picker', async () => {
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
});
