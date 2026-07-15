import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../../core/scene';
import { serializeProject } from '../../io/project';
import type { PlatformAdapter } from '../../platform/types';
import { handleOpenProject } from './file-actions';

describe('project file machine capability repair', () => {
  it('keeps an automatically repaired load dirty and explains the repair', async () => {
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
        kind: 'capability-repaired' as const,
        previousKind: 'cnc' as const,
        activeKind: 'laser' as const,
        preservedCnc: true,
      })),
      markLoaded,
      pushToast,
    });

    expect(markLoaded).toHaveBeenCalledWith('contradictory.lf2', { dirty: true });
    expect(pushToast).toHaveBeenCalledWith(
      'This project was switched to Laser mode because its machine profile is set to Laser only. The previous CNC setup was preserved. Open Machine Setup and choose Laser + CNC to enable both modes.',
      'warning',
    );
  });
});
