import { isGrblhalPasswordSetting } from '../../core/controllers/controller-password-settings';
import { createGrblSettingsBackup, type GrblSettingRow } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';

export type ExportGrblSettingsBackupResult =
  | { readonly ok: true; readonly displayName: string; readonly holdsPasswords: boolean }
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
  const target = await options.platform.pickFileForSave({
    suggestedName: suggestedBackupName(createdAt),
    extensions: ['.lfgrbl-settings.json'],
  });
  if (target === null) {
    return {
      ok: false,
      reason: 'cancelled',
      message: 'Backup export cancelled.',
    };
  }

  try {
    const backup = createGrblSettingsBackup(options.rows, createdAt);
    await target.write(`${JSON.stringify(backup, null, 2)}\n`);
    return {
      ok: true,
      displayName: target.displayName,
      holdsPasswords: settingsBackupHoldsPasswords(options.rows),
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'write-failed',
      message: `Could not export machine settings backup: ${errMsg(err)}`,
    };
  }
}

/** The backup keeps every value so a restore can put it back, grblHAL's Wi-Fi,
 *  WebUI and MQTT passwords included (audit C4-P3-7); the save flow says so. */
export function settingsBackupHoldsPasswords(rows: ReadonlyArray<GrblSettingRow>): boolean {
  return rows.some((row) => isGrblhalPasswordSetting(row.id) && row.rawValue.trim() !== '');
}

function suggestedBackupName(createdAt: string): string {
  const date = createdAt.slice(0, 10);
  return `kerfdesk-grbl-settings-${date}.lfgrbl-settings.json`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
