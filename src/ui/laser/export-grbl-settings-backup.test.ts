import { describe, expect, it } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import {
  MAX_SAVE_EXTENSION_LENGTH,
  type PlatformAdapter,
  type SaveTarget,
} from '../../platform/types';
import {
  exportGrblSettingsBackup,
  GRBL_SETTINGS_BACKUP_EXTENSION,
} from './export-grbl-settings-backup';

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
      displayName: 'settings.lfgrbl.json',
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('expected text backup');
        written = data;
      },
    };
    const platform = makePlatform(async (req) => {
      expect(req.suggestedName).toBe('kerfdesk-grbl-settings-2026-06-15.lfgrbl.json');
      expect(req.extensions).toEqual(['.lfgrbl.json']);
      return target;
    });

    const result = await exportGrblSettingsBackup({
      platform,
      rows: settingsMapToRows(new Map([[30, '1000']])),
      createdAt: '2026-06-15T09:00:00.000Z',
    });

    expect(result).toEqual({ ok: true, displayName: 'settings.lfgrbl.json' });
    expect(JSON.parse(written)).toMatchObject({
      format: 'laserforge.grbl-settings.backup',
      version: 1,
      createdAt: '2026-06-15T09:00:00.000Z',
      settings: [expect.objectContaining({ code: '$30', rawValue: '1000' })],
    });
    expect(written).toContain('\n  "settings": [\n');
  });

  // Regression: '.lfgrbl-settings.json' (21) exceeded the Chromium accept-type
  // limit, so showSaveFilePicker threw before the dialog opened and the backup
  // button could never save anything.
  it('keeps the backup extension short enough for the browser save picker', () => {
    expect(GRBL_SETTINGS_BACKUP_EXTENSION.length).toBeLessThanOrEqual(MAX_SAVE_EXTENSION_LENGTH);
  });

  it('reports a picker rejection instead of throwing at the caller', async () => {
    const platform = makePlatform(async () => {
      throw new Error('Extension is too long');
    });

    await expect(
      exportGrblSettingsBackup({
        platform,
        rows: settingsMapToRows(new Map([[30, '1000']])),
        createdAt: '2026-06-15T09:00:00.000Z',
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'write-failed',
      message: 'Could not export machine settings backup: Extension is too long',
    });
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
      displayName: 'settings.lfgrbl.json',
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
