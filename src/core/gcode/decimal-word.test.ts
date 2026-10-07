import { describe, expect, it } from 'vitest';
import { formatGcodeDecimal, formatGcodePowerS } from './decimal-word';

// Model only the eight-digit decimal accumulation in the pinned stock GRBL
// nuts_bolts.c read_float; this is not a PWM or hardware-power oracle.
function stockDecimalAccumulation(text: string): number {
  const [integer = '', fraction = ''] = text.split('.');
  const retained = (integer + fraction).slice(0, 8);
  const exponent = Math.max(0, integer.length - 8) - Math.min(fraction.length, 8 - integer.length);
  return Number(retained) * 10 ** exponent;
}

describe('S-word numeric spelling', () => {
  it.each([255, 1000, 1000.25, 70000, 1e21])('spells %s without an exponent', (value) => {
    const text = formatGcodePowerS(value);
    expect(text).not.toMatch(/[eE]/);
    expect(Number(text)).toBe(value);
  });

  it('preserves a representable tiny S that a leading zero would erase', () => {
    expect(stockDecimalAccumulation('0.00000005')).toBe(0);
    expect(formatGcodePowerS(5e-8)).toBe('.00000005');
    expect(stockDecimalAccumulation(formatGcodePowerS(5e-8))).toBe(5e-8);
    expect(formatGcodeDecimal(5e-8)).toBe('0.00000005');
  });

  it('does not imply that spelling extends the stock parser positive range', () => {
    const text = formatGcodePowerS(1e-10);
    expect(Number(text)).toBe(1e-10);
    expect(stockDecimalAccumulation(text)).toBe(0);
  });
});
