import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../../core/scene';
import type { FileHandle, PlatformAdapter } from '../../platform/types';
import { handleOpenProject } from './file-actions';
import { handleOpenGcodePreview } from './gcode-open-action';
import { IMPORT_SOURCE_LIMITS } from './import-source-limits';
import {
  handleImportClbMaterialLibrary,
  handleOpenMaterialLibrary,
} from './material-library-file-actions';
import { importStlFiles } from './stl-import-action';

describe('pre-allocation import limits', () => {
  it.each([
    ['native-project', 'oversize.lf2', handleProject] as const,
    ['lightburn-project', 'oversize.lbrn2', handleProject] as const,
    ['material-library', 'oversize.lfml.json', handleMaterial] as const,
    ['lightburn-clb', 'oversize.clb', handleClb] as const,
    ['gcode', 'oversize.gcode', handleGcode] as const,
  ])('rejects %s before reading file text', async (kind, name, run) => {
    const text = vi.fn(async () => 'must not be read');
    const pushToast = vi.fn();
    const file = { name, size: IMPORT_SOURCE_LIMITS[kind] + 1, text };

    await run(platformFor(file), pushToast);

    expect(text).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/import limit/i), 'error');
  });

  it('rejects an oversized STL before allocating its ArrayBuffer', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const file = {
      name: 'oversize.stl',
      size: IMPORT_SOURCE_LIMITS.stl + 1,
      arrayBuffer,
    } as unknown as File;
    const pushToast = vi.fn();

    await importStlFiles([file], {
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
      importObject: vi.fn(),
      pushToast,
    });

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/import limit/i), 'error');
  });
});

function platformFor(file: FileHandle): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [file],
    pickFileForSave: async () => null,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

type Run = (platform: PlatformAdapter, pushToast: ReturnType<typeof vi.fn>) => Promise<void>;

const handleProject: Run = async (platform, pushToast) => {
  await handleOpenProject({
    platform,
    setProject: vi.fn(() => ({ kind: 'loaded' as const })),
    markLoaded: vi.fn(),
    pushToast,
  });
};

const handleMaterial: Run = async (platform, pushToast) => {
  await handleOpenMaterialLibrary({ platform, setMaterialLibrary: vi.fn(), pushToast });
};

const handleClb: Run = async (platform, pushToast) => {
  await handleImportClbMaterialLibrary({ platform, setMaterialLibrary: vi.fn(), pushToast });
};

const handleGcode: Run = async (platform, pushToast) => {
  await handleOpenGcodePreview(platform, vi.fn(), pushToast);
};
