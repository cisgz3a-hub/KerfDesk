import { describe, expect, it, vi } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { handleSalvageExportProject } from './salvage-export';

function platformWith(pickFileForSave: PlatformAdapter['pickFileForSave']): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave,
    serial: { isSupported: () => false, requestPort: async () => null },
  } satisfies PlatformAdapter;
}

function saveTarget(write: SaveTarget['write']): SaveTarget {
  return { displayName: 'logo-recovery.lf2', write };
}

// A project whose live workspace width is NaN: it still serializes to JSON
// (the value round-trips as null), but strict validation rejects it — so it
// is exactly what the canonical Save refuses yet the salvage path can rescue.
function invalidLiveProject(): Project {
  return {
    ...createProject(),
    workspace: { ...createProject().workspace, width: Number.NaN },
  } as Project;
}

describe('handleSalvageExportProject', () => {
  it('writes the raw project to a freshly picked recovery file and warns', async () => {
    const write = vi.fn(async () => undefined);
    const pickFileForSave = vi.fn(async () => saveTarget(write));
    const pushToast = vi.fn();

    await expect(
      handleSalvageExportProject({
        platform: platformWith(pickFileForSave),
        project: invalidLiveProject(),
        savedName: 'logo.lf2',
        pushToast,
      }),
    ).resolves.toBe('exported');

    expect(pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'logo-recovery.lf2',
      extensions: ['.lf2'],
    });
    expect(write).toHaveBeenCalledOnce();
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('raw recovery copy'), 'warning');
  });

  it('defaults the recovery name when the project was never saved', async () => {
    const pickFileForSave = vi.fn(async () => null);
    await handleSalvageExportProject({
      platform: platformWith(pickFileForSave),
      project: invalidLiveProject(),
      savedName: null,
      pushToast: vi.fn(),
    });
    expect(pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'untitled-recovery.lf2',
      extensions: ['.lf2'],
    });
  });

  it('reports cancelled without writing when the picker is dismissed', async () => {
    const pushToast = vi.fn();
    await expect(
      handleSalvageExportProject({
        platform: platformWith(async () => null),
        project: invalidLiveProject(),
        savedName: null,
        pushToast,
      }),
    ).resolves.toBe('cancelled');
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('reports an error when the recovery write fails', async () => {
    const write = vi.fn(async () => {
      throw new Error('disk full');
    });
    const pushToast = vi.fn();
    await expect(
      handleSalvageExportProject({
        platform: platformWith(async () => saveTarget(write)),
        project: invalidLiveProject(),
        savedName: 'logo.lf2',
        pushToast,
      }),
    ).resolves.toBe('error');
    expect(pushToast).toHaveBeenCalledWith('Could not export a recovery copy: disk full', 'error');
  });
});
