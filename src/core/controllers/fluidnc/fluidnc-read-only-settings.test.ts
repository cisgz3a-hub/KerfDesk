import { describe, expect, it } from 'vitest';
import {
  FLUIDNC_READ_ONLY_SETTING_ERROR_CODE,
  FLUIDNC_READ_ONLY_SETTING_IDS,
  isFluidncReadOnlySetting,
} from './fluidnc-read-only-settings';

describe('isFluidncReadOnlySetting', () => {
  it('reports the ReadOnlySetting error FluidNC answers a proxy write with', () => {
    expect(FLUIDNC_READ_ONLY_SETTING_ERROR_CODE).toBe(162);
  });

  it('covers every integer proxy FluidNC registers in make_proxies()', () => {
    expect([...FLUIDNC_READ_ONLY_SETTING_IDS].sort((a, b) => a - b)).toEqual([
      20, 21, 22, 23, 30, 32,
    ]);
  });

  it('treats $32 laser mode and $30 max spindle speed as read-only', () => {
    expect(isFluidncReadOnlySetting(32)).toBe(true);
    expect(isFluidncReadOnlySetting(30)).toBe(true);
  });

  it('leaves settings FluidNC does not proxy alone', () => {
    // $31 is absent from make_proxies(), so KerfDesk must not claim it is a
    // read-only mirror of the YAML config.
    expect(isFluidncReadOnlySetting(31)).toBe(false);
    expect(isFluidncReadOnlySetting(110)).toBe(false);
  });
});
