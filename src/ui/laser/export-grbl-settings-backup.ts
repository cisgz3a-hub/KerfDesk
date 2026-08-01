import { createGrblSettingsBackup, type GrblSettingRow } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';

export type ExportGrblSettingsBackupResult =
  | { readonly ok: true; readonly displayName: string }
  | {
      readonly ok: false;
      readonly reason: 'cancelled' | 'no-settings' | 'write-failed';
      readonly message: string;
    };

export type ExportGrblSettingsBackupOptions = {
  readonly platform: PlatformAdapter;
  readonly rows: ReadonlyArray<GrblSettingRow>;
  readonly createdAt?: string;
};

export async function exportGrblSettingsBackup(
  options: ExportGrblSettingsBackupOptions,
): Promise<ExportGrblSettingsBackupResult> {
  if (options.rows.length === 0) {
    return {
      ok: false,
      reason: 'no-settings',
      message: 'Read machine settings before exporting a backup.',
    };
  }

  const createdAt = options.createdAt ?? new Date().toISOString();
  try {
    // The picker itself can reject (an unsupported platform, or an accept-type
    // the browser refuses). Keep it inside the guard so the panel gets a typed
    // result instead of an unhandled rejection and a dead button.
    const target = await options.platform.pickFileForSave({
      suggestedName: suggestedBackupName(createdAt),
      extensions: [GRBL_SETTINGS_BACKUP_EXTENSION],
    });
    if (target === null) {
      return {
        ok: false,
        reason: 'cancelled',
        message: 'Backup export cancelled.',
      };
    }
    const backup = createGrblSettingsBackup(options.rows, createdAt);
    await target.write(`${JSON.stringify(backup, null, 2)}\n`);
    return { ok: true, displayName: target.displayName };
  } catch (err) {
    return {
      ok: false,
      reason: 'write-failed',
      message: `Could not export machine settings backup: ${errMsg(err)}`,
    };
  }
}

/** Must stay within MAX_SAVE_EXTENSION_LENGTH: Chromium refuses to open the
 * save picker at all for a longer extension, which made the earlier
 * '.lfgrbl-settings.json' export unreachable in every browser. */
export const GRBL_SETTINGS_BACKUP_EXTENSION = '.lfgrbl.json';

function suggestedBackupName(createdAt: string): string {
  const date = createdAt.slice(0, 10);
  return `kerfdesk-grbl-settings-${date}${GRBL_SETTINGS_BACKUP_EXTENSION}`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
