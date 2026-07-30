// Replaces import-preallocation-guards.test.ts and import-size-guard.test.ts,
// which pinned the refusals this suite now pins the ABSENCE of.
//
// Rule 7 / ADR-228 names `import` as a guard surface, so an oversize file must
// be imported and merely advised about. Each case therefore asserts that the
// production route is attempted and the operator is told with a warning rather
// than an import-limit error. Worker-backed Blob routes must not reread the
// entire source on the UI thread.

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../../core/scene';
import type { FileHandle, PlatformAdapter } from '../../platform/types';
import { handleOpenProject } from './file-actions';
import { handleOpenGcodePreview } from './gcode-open-action';
import {
  IMPORT_SOURCE_ADVISORY_BYTES,
  LARGE_IMPORT_ADVISORY_BYTES,
  importSourceSizeAdvisory,
  largeImportAdvisory,
} from './import-size-advisory';
import {
  handleImportClbMaterialLibrary,
  handleOpenMaterialLibrary,
} from './material-library-file-actions';
import { importStlFiles } from './stl-import-action';

const SLOW_IMPORT = /may take a while/i;

describe('largeImportAdvisory', () => {
  it('stays silent at or below the advisory size', () => {
    expect(largeImportAdvisory('small.svg', LARGE_IMPORT_ADVISORY_BYTES)).toBeNull();
  });

  it('names the file and its size above the advisory size', () => {
    const advisory = largeImportAdvisory('huge.png', 31 * 1024 * 1024);
    expect(advisory).toMatch(SLOW_IMPORT);
    expect(advisory).toContain('huge.png');
    expect(advisory).toContain('31 MB');
  });

  it('advises rather than refusing well past the old 25 MB ceiling', () => {
    expect(largeImportAdvisory('enormous.dxf', 500 * 1024 * 1024)).toMatch(SLOW_IMPORT);
  });
});

describe('importSourceSizeAdvisory', () => {
  it('stays silent when the adapter supplies no size', () => {
    expect(importSourceSizeAdvisory({ name: 'x.lf2' }, 'native-project')).toBeNull();
  });

  it('advises above the per-source size', () => {
    const size = IMPORT_SOURCE_ADVISORY_BYTES['native-project'] + 1;
    expect(importSourceSizeAdvisory({ name: 'big.lf2', size }, 'native-project')).toMatch(
      SLOW_IMPORT,
    );
  });
});

describe('oversize imports proceed', () => {
  it.each([
    ['native-project', 'oversize.lf2', handleProject] as const,
    ['lightburn-project', 'oversize.lbrn2', handleProject] as const,
    ['material-library', 'oversize.lfml.json', handleMaterial] as const,
    ['lightburn-clb', 'oversize.clb', handleClb] as const,
    ['gcode', 'oversize.gcode', handleGcode] as const,
  ])('reads %s and warns instead of refusing', async (kind, name, run) => {
    const text = vi.fn(async () => 'read me');
    const pushToast = vi.fn();
    const file = { name, size: IMPORT_SOURCE_ADVISORY_BYTES[kind] + 1, text };

    await run(platformFor(file), pushToast);

    // The old build refused here and never touched the bytes.
    expect(text).toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(SLOW_IMPORT), 'warning');
    expect(pushToast).not.toHaveBeenCalledWith(
      expect.stringMatching(/import limit/i),
      expect.anything(),
    );
  });

  it('routes an oversized STL to its worker without reading an ArrayBuffer on the UI thread', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const file = {
      name: 'oversize.stl',
      size: IMPORT_SOURCE_ADVISORY_BYTES.stl + 1,
      arrayBuffer,
    } as unknown as File;
    const pushToast = vi.fn();

    await importStlFiles([file], {
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
      importObject: vi.fn(),
      pushToast,
    });

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(SLOW_IMPORT), 'warning');
    expect(pushToast).toHaveBeenCalledWith('oversize.stl: STL import worker unavailable', 'error');
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
