import { describe, expect, it, vi } from 'vitest';
import { projectOpenRequestEpochCallbacks } from '../../__fixtures__/file-actions';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../../core/scene';
import { serializeProject } from '../../io/project';
import type { PlatformAdapter } from '../../platform/types';
import { handleOpenProject } from './file-actions';

describe('project file machine capability disclosure', () => {
  it('keeps a mismatched mode unchanged and explains the warning', async () => {
    const markLoaded = vi.fn();
    const pushToast = vi.fn();
    const project = {
      ...createProject({
        ...createProject().device,
        capabilities: ['laser-output'] as const,
      }),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    };
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [
        {
          name: 'contradictory.lf2',
          text: async () => serializeProject(project),
        },
      ],
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };

    await handleOpenProject({
      platform,
      setProject: vi.fn(() => ({
        kind: 'capability-warning' as const,
        activeKind: 'cnc' as const,
      })),
      markLoaded,
      pushToast,
      ...projectOpenRequestEpochCallbacks(),
      getProjectDocumentEpoch: () => 0,
    });

    expect(markLoaded).toHaveBeenCalledWith('contradictory.lf2');
    expect(pushToast).toHaveBeenCalledWith(
      'This project remains in CNC mode even though its saved capability label does not include that mode. Review Machine Setup; no machine mode or saved settings were silently rewritten.',
      'warning',
    );
  });

  it('keeps a canonicalized saved workspace dirty for explicit reconciliation', async () => {
    const markLoaded = vi.fn();
    const project = createProject();
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [
        {
          name: 'mismatched-bed.lf2',
          text: async () =>
            serializeProject({
              ...project,
              workspace: { ...project.workspace, width: project.workspace.width - 10 },
            }),
        },
      ],
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };

    await handleOpenProject({
      platform,
      setProject: vi.fn(() => ({ kind: 'loaded' as const, projectBedReconciled: true })),
      markLoaded,
      pushToast: vi.fn(),
      ...projectOpenRequestEpochCallbacks(),
      getProjectDocumentEpoch: () => 0,
    });

    expect(markLoaded).toHaveBeenCalledWith('mismatched-bed.lf2', { dirty: true });
  });
});
