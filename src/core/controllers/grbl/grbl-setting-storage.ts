// What stock GRBL 1.1h can store for a `$x=` write, and whether a `$$` re-read
// confirms it (controller audit 2026-09-25 GP-5).
//
// settings.c stores ids 0-6, 10, 13, 20-23, 26 and 32 through
// `uint8_t int_value = trunc(value)`: the fraction is dropped, a value above
// 255 does not fit, and the on/off ids keep only zero or non-zero. GRBL still
// answers `ok`. `$$` prints the other (float) settings to 3 decimals and
// $30/$31 to 0 (report.c, config.h N_DECIMAL_SETTINGVALUE / N_DECIMAL_RPMVALUE).
// grblHAL and FluidNC store these ids with their own types, so the storage
// check is for stock GRBL only; the re-read comparison works for every
// firmware at the precision the controller printed.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/settings.c#L227-L303

const STOCK_GRBL_UINT8_SETTING_IDS: ReadonlySet<number> = new Set([0, 1, 2, 3, 10, 23, 26]);
const STOCK_GRBL_FLAG_SETTING_IDS: ReadonlySet<number> = new Set([4, 5, 6, 13, 20, 21, 22, 32]);

/** Why stock GRBL would store a different value than the one typed, or null. */
export function stockGrblSettingStorageIssue(id: number, value: number): string | null {
  if (STOCK_GRBL_FLAG_SETTING_IDS.has(id) && value !== 0 && value !== 1) {
    return `$${id} is an on/off setting: enter 0 or 1. GRBL would store any other number as 1.`;
  }
  if (
    STOCK_GRBL_UINT8_SETTING_IDS.has(id) &&
    (!Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return `GRBL stores $${id} as a whole number from 0 to 255, so ${value} would be stored as a different value.`;
  }
  return null;
}

/** True when the value the controller printed is the requested value at the
 *  precision it was printed with (GRBL rounds floats to 3 decimals). */
export function settingReadbackMatches(reportedRaw: string, requested: number): boolean {
  const trimmed = reportedRaw.trim();
  const reported = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(reported) || !Number.isFinite(requested)) return false;
  const decimals = /\.(\d+)$/.exec(trimmed)?.[1]?.length ?? 0;
  return Math.abs(reported - requested) <= 0.5 * 10 ** -decimals + 1e-9;
}
