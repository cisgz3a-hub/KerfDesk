import { describe, expect, it } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { exportGrblSettingsBackup } from './export-grbl-settings-backup';

function makePlatform(save: PlatformAdapter['pickFileForSave']): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: save,
    serial: {
      isSupported: () => false,
      requestPort: async () => null,
    },
  };
}

describe('exportGrblSettingsBackup', () => {
  it('writes a pretty JSON backup through PlatformAdapter', async () => {
    let written = '';
    const target: SaveTarget = {
      displayName: 'settings.lfgrbl-settings.json',
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('expected text backup');
        written = data;
      },
    };
    const platform = makePlatform(async (req) => {
      expect(req.suggestedName).toBe('kerfdesk-grbl-settings-2026-06-15.lfgrbl-settings.json');
      expect(req.extensions).toEqual(['.lfgrbl-settings.json']);
      return target;
    });

    const result = await exportGrblSettingsBackup({
      platform,
      rows: settingsMapToRows(new Map([[30, '1000']])),
      createdAt: '2026-06-15T09:00:00.000Z',
    });

    expect(result).toEqual({ ok: true, displayName: 'settings.lfgrbl-settings.json' });
    expect(JSON.parse(written)).toMatchObject({
      format: 'laserforge.grbl-settings.backup',
      version: 1,
      createdAt: '2026-06-15T09:00:00.000Z',
      settings: [expect.objectContaining({ code: '$30', rawValue: '1000' })],
    });
    expect(written).toContain('\n  "settings": [\n');
  });

  it('returns no-settings when rows are empty', async () => {
    const platform = makePlatform(async () => {
      throw new Error('picker should not open');
    });

    await expect(
      exportGrblSettingsBackup({
        platform,
        rows: [],
        createdAt: '2026-06-15T09:00:00.000Z',
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'no-settings',
      message: 'Read machine settings before exporting a backup.',
    });
  });

  it('returns cancelled when the save picker is cancelled', async () => {
    const platform = makePlatform(async () => null);

    await expect(
      exportGrblSettingsBackup({
        platform,
        rows: settingsMapToRows(new Map([[30, '1000']])),
        createdAt: '2026-06-15T09:00:00.000Z',
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
      message: 'Backup export cancelled.',
    });
  });

  it('keeps unknown settings in the exported backup', async () => {
    let written = '';
    const platform = makePlatform(async () => ({
      displayName: 'settings.lfgrbl-settings.json',
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('expected text backup');
        written = data;
      },
    }));

    await exportGrblSettingsBackup({
      platform,
      rows: settingsMapToRows(new Map([[999, 'custom']])),
      createdAt: '2026-06-15T09:00:00.000Z',
    });

    expect(JSON.parse(written).settings).toEqual([
      expect.objectContaining({
        code: '$999',
        rawValue: 'custom',
        known: false,
      }),
    ]);
  });
});
