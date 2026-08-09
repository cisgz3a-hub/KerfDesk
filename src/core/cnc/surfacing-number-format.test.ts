import { describe, expect, it } from 'vitest';
import { buildSurfacingProgram } from './surfacing';
import {
  formatSurfacingExactNumber,
  formatSurfacingInteger,
  formatSurfacingNumber,
} from './surfacing-number-format';

const HUGE_DECIMAL = '1000000000000000000000';

describe('surfacing number formatting', () => {
  it('expands every finite magnitude without exponent notation', () => {
    expect(formatSurfacingNumber(1e21)).toBe(`${HUGE_DECIMAL}.000`);
    expect(formatSurfacingNumber(-1e21)).toBe(`-${HUGE_DECIMAL}.000`);
    expect(formatSurfacingInteger(1e21)).toBe(HUGE_DECIMAL);
    expect(formatSurfacingExactNumber(1e-9)).toBe('0.000000001');

    const maximum = formatSurfacingNumber(Number.MAX_VALUE);
    expect(maximum).not.toMatch(/[eE]/);
    expect(maximum).toMatch(/^\d{309}\.000$/);
    expect(Number(maximum)).toBe(Number.MAX_VALUE);
  });

  it('keeps every huge emitted word and header out of exponent notation', () => {
    const result = buildSurfacingProgram({
      widthMm: 1e21,
      heightMm: 1e21,
      bitDiameterMm: 1e21,
      stepoverPct: 100,
      depthPerPassMm: 1e21,
      totalDepthMm: 1e21,
      feedMmPerMin: 1e21,
      plungeMmPerMin: 1e21,
      spindleRpm: 1e21,
      spindleSpinupSec: 1e21,
      safeZMm: 1e21,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const { program } = result;

    expect(program.planning.kind).toBe('complete');
    expect(program.outputPrecision).toBeNull();
    expect(program.lines).toEqual(
      expect.arrayContaining([
        `; area ${HUGE_DECIMAL}.000 x ${HUGE_DECIMAL}.000 mm, bit ${HUGE_DECIMAL}.000 mm, stepover 100%`,
        `G0 Z${HUGE_DECIMAL}.000`,
        `M3 S${HUGE_DECIMAL}`,
        `G4 P${HUGE_DECIMAL}.000`,
        `G1 Z-${HUGE_DECIMAL}.000 F${HUGE_DECIMAL}.000`,
        `G1 Y${HUGE_DECIMAL}.000 F${HUGE_DECIMAL}.000`,
        `G1 X${HUGE_DECIMAL}.000 F${HUGE_DECIMAL}.000`,
      ]),
    );
    expect(program.lines.join('\n')).not.toMatch(/[eE][+-]\d/);
    expect(program.lines.some((line) => line.includes('INCOMPLETE'))).toBe(false);
  });
});
