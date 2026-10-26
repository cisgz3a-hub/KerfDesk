import { describe, expect, it, vi } from 'vitest';
import type { SaveDirectoryTarget } from '../../platform/types';
import { webAdapter } from '../../platform/web/web-adapter';
import { chromiumDirectory } from '../../platform/web/chromium-save-picker.test-support';
import { tileFolderContents, tileFolderWarnings } from './tile-folder-check';

function folder(names: string[]): SaveDirectoryTarget {
  return {
    file: vi.fn(() => {
      throw new Error('History inspection must not write files');
    }),
    exists: async (name) => names.includes(name),
    listFiles: async () => names,
  };
}

const oldBits = ['job_tile-r1-c1_bit-1-of-2.nc', 'job_tile-r1-c1_bit-2-of-2.nc'];

describe('tile folder export history', () => {
  it.each([
    ['one bit', ['job_tile-r1-c1']],
    ['three bits', [1, 2, 3].map((n) => `job_tile-r1-c1_bit-${n}-of-3`)],
  ])('names obsolete bit files when changing to %s', async (_label, names) => {
    const directory = folder(oldBits);
    const result = await tileFolderContents(
      directory,
      names.map((name) => ({ name, gcode: '' })),
    );
    expect(result).toEqual({ replaced: [], earlier: oldBits });
    expect(tileFolderWarnings(result).join('\n')).toContain(oldBits[0]);
    expect(directory.file).not.toHaveBeenCalled();
  });

  it('finds removed tiles but ignores other jobs, backups and non-tile files', async () => {
    const directory = folder([
      ...oldBits,
      'job_tile-r1-c2.nc',
      'job_tile-r2-c1.nc',
      'job_tile-r1-c2.nc.bak',
      'job-other_tile-r1-c1.nc',
      'job.nc',
    ]);
    expect(await tileFolderContents(directory, [{ name: 'job_tile-r1-c2', gcode: '' }])).toEqual({
      replaced: ['job_tile-r1-c2.nc'],
      earlier: [...oldBits, 'job_tile-r2-c1.nc'],
    });
  });

  it('preserves the directory adapter collision rules when file name case differs', async () => {
    const directory = {
      ...folder(['JOB_tile-r1-c1.nc']),
      exists: async (name: string) => name.toLowerCase() === 'job_tile-r1-c1.nc',
    };
    expect(await tileFolderContents(directory, [{ name: 'job_tile-r1-c1', gcode: '' }])).toEqual({
      replaced: ['job_tile-r1-c1.nc'],
      earlier: [],
    });
  });

  it('reports an unreadable history without preventing a save or losing known collisions', async () => {
    const directory = {
      ...folder(['job_tile-r1-c1.nc']),
      listFiles: async () => {
        throw new Error('lost access');
      },
    };
    const result = await tileFolderContents(directory, [{ name: 'job_tile-r1-c1', gcode: '' }]);
    expect(result.replaced).toEqual(['job_tile-r1-c1.nc']);
    expect(tileFolderWarnings(result).join('\n')).toContain('could not check');
  });

  it('retains known history when a later collision lookup fails', async () => {
    const directory = {
      ...folder([...oldBits, 'job_tile-r1-c2.nc']),
      exists: async () => {
        throw new Error('lost access');
      },
    };
    const result = await tileFolderContents(directory, [
      { name: 'job_tile-r1-c1', gcode: '' },
      { name: 'job_tile-r1-c2', gcode: '' },
    ]);
    expect(result).toEqual({
      replaced: ['job_tile-r1-c2.nc'],
      earlier: oldBits,
      inspectionIncomplete: true,
    });
  });

  it('reads previous bit files through the production directory adapter without changing disk', async () => {
    const disk = new Map(oldBits.map((name) => [name, 'old executable program']));
    const descriptor = Object.getOwnPropertyDescriptor(window, 'showDirectoryPicker');
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => chromiumDirectory(disk),
    });
    try {
      const directory = await webAdapter.reserveSaveDirectory?.();
      expect(
        await tileFolderContents(directory ?? undefined, [{ name: 'job_tile-r1-c1', gcode: '' }]),
      ).toEqual({ replaced: [], earlier: oldBits });
      expect([...disk]).toEqual(oldBits.map((name) => [name, 'old executable program']));
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(window, 'showDirectoryPicker');
      else Object.defineProperty(window, 'showDirectoryPicker', descriptor);
    }
  });
});
