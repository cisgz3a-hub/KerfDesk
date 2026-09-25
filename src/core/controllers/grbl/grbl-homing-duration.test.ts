import { describe, expect, it } from 'vitest';
import { grblHomingDurationBoundMs } from './grbl-homing-duration';
import { settingsMapToRows } from './grbl-settings';

function rows(values: Record<number, string>) {
  return settingsMapToRows(new Map(Object.entries(values).map(([id, v]) => [Number(id), v])));
}

// gnea/grbl defaults.h (DEFAULTS_GENERIC): 200 mm travel, $24=25, $25=500,
// $26=250, $27=1.
const GRBL_DEFAULTS = {
  24: '25',
  25: '500',
  26: '250',
  27: '1',
  130: '200',
  131: '200',
  132: '200',
};

describe('grblHomingDurationBoundMs', () => {
  it('sums the search, pull-off and locate moves of every axis at their rates', () => {
    // Per axis: (1.5 * 200 + 2 * 1) / 500 + 5 * 1 / 25 = 0.804 min; three axes
    // = 2.412 min, plus 4 debounces of 250 ms per axis.
    expect(grblHomingDurationBoundMs(rows(GRBL_DEFAULTS))).toBeCloseTo(144_720 + 3_000, 6);
  });

  it('scales with the travel a long router must search', () => {
    // X and Y: (1500 + 2) / 500 + 0.2 = 3.204 min; Z: (150 + 2) / 500 + 0.2.
    const router = { ...GRBL_DEFAULTS, 26: '0', 130: '1000', 131: '1000', 132: '100' };
    expect(grblHomingDurationBoundMs(rows(router))).toBeCloseTo(6.912 * 60_000, 6);
  });

  it('is null when a rate, the pull-off or a travel was not reported', () => {
    for (const missing of [24, 25, 27, 130, 131, 132]) {
      const partial = Object.fromEntries(
        Object.entries(GRBL_DEFAULTS).filter(([id]) => Number(id) !== missing),
      );
      expect(grblHomingDurationBoundMs(rows(partial))).toBeNull();
    }
    expect(grblHomingDurationBoundMs(rows({ ...GRBL_DEFAULTS, 25: '0' }))).toBeNull();
  });

  it('treats a missing debounce as none', () => {
    const { 26: _debounce, ...withoutDebounce } = GRBL_DEFAULTS;
    void _debounce;
    expect(grblHomingDurationBoundMs(rows(withoutDebounce))).toBeCloseTo(144_720, 6);
  });
});
