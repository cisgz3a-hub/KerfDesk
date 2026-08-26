import { describe, expect, it } from 'vitest';
import { parseEnglishDecimalInput, validateEnglishDecimalInput } from './english-decimal-input';

describe('English decimal input contract', () => {
  it('round-trips decimal-point values without silently altering them', () => {
    expect(parseEnglishDecimalInput('12.5')).toBe(12.5);
    expect(parseEnglishDecimalInput('0')).toBe(0);
    expect(parseEnglishDecimalInput('-.25')).toBe(-0.25);
  });

  it.each(['12,5', '1e2', '0x10', '+3', 'Infinity', 'NaN'])('rejects %s explicitly', (value) => {
    expect(parseEnglishDecimalInput(value)).toBeNull();
    expect(validateEnglishDecimalInput(value)).toContain('decimal point');
  });
});
