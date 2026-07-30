import { describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { importStlFiles } from './stl-import-action';

describe('importStlFiles', () => {
  it('does not fall back to whole-ArrayBuffer parsing on the UI thread', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const pushToast = vi.fn();
    const file = {
      name: 'part.stl',
      size: 100,
      arrayBuffer,
    } as unknown as File;

    await importStlFiles([file], {
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
      importObject: vi.fn(),
      pushToast,
    });

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith('part.stl: STL import worker unavailable', 'error');
  });
});
