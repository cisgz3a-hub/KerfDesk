import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { importStlFiles } from './stl-import-action';

describe('importStlFiles', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('imports through the disclosed legacy fallback when worker construction fails', async () => {
    vi.stubGlobal('Worker', function WorkerUnavailable(): never {
      throw new Error('workers blocked');
    });
    const ascii = [
      'solid part',
      'facet normal 0 0 1',
      'outer loop',
      'vertex 0 0 0',
      'vertex 10 0 0',
      'vertex 0 10 1',
      'endloop',
      'endfacet',
      'endsolid part',
    ].join('\n');
    const bytes = new TextEncoder().encode(ascii);
    const arrayBuffer = vi.fn(async () => bytes.buffer as ArrayBuffer);
    const pushToast = vi.fn();
    const importObject = vi.fn();
    const file = {
      name: 'part.stl',
      size: bytes.byteLength,
      arrayBuffer,
    } as unknown as File;

    await importStlFiles([file], {
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
      importObject,
      pushToast,
    });

    expect(arrayBuffer).toHaveBeenCalledOnce();
    expect(importObject).toHaveBeenCalledOnce();
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/part\.stl.*main thread.*unresponsive/i),
      'warning',
    );
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('Imported relief'), 'success');
  });
});
