import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { serializeProject } from '../../io/project';
import type { PlatformAdapter } from '../../platform/types';
import { handleOpenProject } from './file-actions';

afterEach(() => vi.unstubAllGlobals());

describe('project worker fallback', () => {
  it('opens a Blob-backed native project when Worker construction fails', async () => {
    installUnavailableWorker();
    const projectText = serializeProject(createProject());
    const blob = { size: projectText.length } as unknown as Blob;
    const readFile = vi.fn(async () => projectText);
    const messages: Array<{ message: string; variant?: string }> = [];
    const setProject = vi.fn(() => ({ kind: 'loaded' as const }));
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [
        {
          name: 'fallback.lf2',
          size: blob.size,
          text: readFile,
          blob: async () => blob,
        },
      ],
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };

    await handleOpenProject({
      platform,
      setProject,
      markLoaded: vi.fn(),
      pushToast: (message, variant) =>
        messages.push(variant === undefined ? { message } : { message, variant }),
    });

    expect(readFile).toHaveBeenCalledOnce();
    expect(setProject).toHaveBeenCalledOnce();
    expect(messages).toContainEqual({
      message: expect.stringMatching(/fallback\.lf2.*main thread.*unresponsive/i),
      variant: 'warning',
    });
    expect(messages).toContainEqual({
      message: 'Opened fallback.lf2',
      variant: 'success',
    });
  });
});

function installUnavailableWorker(): void {
  vi.stubGlobal('Worker', function WorkerUnavailable(): never {
    throw new Error('workers blocked');
  });
}
