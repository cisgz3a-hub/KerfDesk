import { describe, expect, it } from 'vitest';
import { settingReadbackMatches, stockGrblSettingStorageIssue } from './grbl-setting-storage';

// Controller audit 2026-09-25 GP-5: gnea/grbl settings.c stores the integer
// settings through `uint8_t int_value = trunc(value)` and `$$` prints floats to
// 3 decimals, $30/$31 to 0.
describe('stockGrblSettingStorageIssue', () => {
  it.each([
    [26, 300],
    [1, 25.5],
    [10, -1],
  ])('refuses $%i=%d, which GRBL would store as a different value', (id, value) => {
    expect(stockGrblSettingStorageIssue(id, value)).toMatch(/whole number from 0 to 255/);
  });

  it('refuses an on/off setting other than 0 or 1', () => {
    expect(stockGrblSettingStorageIssue(22, 2)).toMatch(/enter 0 or 1/);
  });

  it.each([
    [26, 250],
    [1, 255],
    [11, 0.0105],
    [110, 5000.25],
    [22, 1],
  ])('accepts $%i=%d', (id, value) => {
    expect(stockGrblSettingStorageIssue(id, value)).toBeNull();
  });
});

describe('settingReadbackMatches', () => {
  it('accepts a float the controller printed rounded to 3 decimals', () => {
    expect(settingReadbackMatches('0.010', 0.0105)).toBe(true);
    expect(settingReadbackMatches('0.011', 0.0105)).toBe(true);
    expect(settingReadbackMatches('1000', 1000.4)).toBe(true);
  });

  it('rejects a value the controller stored differently', () => {
    expect(settingReadbackMatches('44', 300)).toBe(false);
    expect(settingReadbackMatches('0.020', 0.0105)).toBe(false);
    expect(settingReadbackMatches('', 0)).toBe(false);
  });
});
