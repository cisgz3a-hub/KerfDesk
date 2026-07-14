import { describe, expect, it, vi } from 'vitest';
import { createProject, type Project } from '../../core/scene';
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
});
