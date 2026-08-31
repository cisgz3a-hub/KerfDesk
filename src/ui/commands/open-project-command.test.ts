import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { serializeProject } from '../../io/project';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { openProjectCommand } from './open-project-command';

describe('openProjectCommand', () => {
  beforeEach(() => {
    useStore.getState().newProject();
    useStore.setState({ dirty: false, projectOpenRequestEpoch: 0 });
  });

  it('opens against the live document epoch and retains its success feedback', async () => {
    const opened = { ...projectWithLine(), notes: 'wrapper-owned document' };
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [
        { name: 'wrapper.lf2', text: async () => serializeProject(opened) },
      ],
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };
    const pushToast = vi.fn();

    await openProjectCommand(platform, pushToast);

    expect(useStore.getState().project.notes).toBe('wrapper-owned document');
    expect(useStore.getState().savedName).toBe('wrapper.lf2');
    expect(useStore.getState().projectOpenRequestEpoch).toBe(1);
    expect(pushToast).toHaveBeenCalledWith('Opened wrapper.lf2', 'success');
  });
});
