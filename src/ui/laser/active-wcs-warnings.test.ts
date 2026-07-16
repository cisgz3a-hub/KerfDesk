import { describe, expect, it } from 'vitest';
import { detectActiveWcsMismatchWarnings } from './active-wcs-warnings';

describe('detectActiveWcsMismatchWarnings (C6)', () => {
  it('is silent when the active WCS is the emitted G54', () => {
    expect(detectActiveWcsMismatchWarnings('G54')).toEqual([]);
  });

  it('is silent when the active WCS is unknown (never selected)', () => {
    expect(detectActiveWcsMismatchWarnings(null)).toEqual([]);
  });

  it('warns for each non-G54 active WCS that emission would mismatch', () => {
    for (const wcs of ['G55', 'G56', 'G57', 'G58', 'G59'] as const) {
      const warnings = detectActiveWcsMismatchWarnings(wcs);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(wcs);
      expect(warnings[0]).toContain('G54');
    }
  });
});
