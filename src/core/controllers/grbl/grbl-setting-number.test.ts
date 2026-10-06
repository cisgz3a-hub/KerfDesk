import { describe, expect, it } from 'vitest';
import { encodeGrblSettingValue } from './grbl-setting-number';

describe('GRBL setting decimal encoding', () => {
  it.each([
    [1e-7, '0.0000001'],
    [1e-8, '.00000001'],
    [1.1e-7, '.00000011'],
    [0.01050001, '.01050001'],
    [1e21, '1000000000000000000000'],
    [1.2345678e21, '1234567800000000000000'],
    [1.23456789e21, '1234567890000000000000'],
    [-1e21, '-1000000000000000000000'],
    [0, '0'],
    [-0, '0'],
    [0.0105, '0.0105'],
    [1000.125, '1000.125'],
  ] as const)('encodes %s without changing its numeric value', (input, expected) => {
    expect(encodeGrblSettingValue(30, input)).toEqual({ kind: 'ok', value: expected });
    expect(Number(expected)).toBe(input === 0 ? 0 : input);
  });

  it.each(['1000.12500', '1000.125001', '0.0105000', '+10', '.5', '1.', '-0.00'])(
    'retains the precision and spelling of supported ordinary decimal %s',
    (value) => expect(encodeGrblSettingValue(11, value)).toEqual({ kind: 'ok', value }),
  );

  it.each([
    ['1e-7', '0.0000001'],
    ['1.2500E+3', '1250.0'],
    ['1.05e-2', '0.0105'],
    ['1e-8', '.00000001'],
    ['1.1e-7', '.00000011'],
    ['0001.05e-2', '00.0105'],
    ['0e9999999999999999999999', '0'],
  ])('expands textual exponent %s without rounding its digits', (input, value) => {
    expect(encodeGrblSettingValue(30, input)).toEqual({ kind: 'ok', value });
  });

  it.each([
    ['0.00000001', '.00000001'],
    ['0.01050001', '.01050001'],
    ['0000.01050001', '.01050001'],
    ['0.00000001000000000000', '.00000001'],
  ])('compacts %s only when its original spelling would lose digits', (input, value) => {
    expect(encodeGrblSettingValue(30, input)).toEqual({ kind: 'ok', value });
    expect(Number(value)).toBe(Number(input));
  });

  it.each([1.23e-7, '1.00000009', '0.000000011', '0.010500011'])(
    'refuses %s when stock GRBL would drop non-zero digits',
    (input) => {
      expect(encodeGrblSettingValue(30, input)).toEqual({
        kind: 'blocked',
        reason: expect.stringContaining('dropping non-zero digits'),
      });
    },
  );

  it('counts significant digits instead of leading zeroes in grblHAL decimal settings', () => {
    const value = '0.000000123456789';
    expect(encodeGrblSettingValue(30, '1.23456789e-7', 'grblhal')).toEqual({
      kind: 'ok',
      value,
    });
    expect(encodeGrblSettingValue(30, 1e-8, 'grblhal')).toEqual({
      kind: 'ok',
      value: '0.00000001',
    });
    const precision = '0.00000012345678901234567';
    expect(encodeGrblSettingValue(30, precision, 'grblhal')).toEqual({
      kind: 'ok',
      value: precision,
    });
  });

  it.each(['1.0000000599'])('refuses %s when grblHAL would drop non-zero digits', (input) => {
    expect(encodeGrblSettingValue(30, input, 'grblhal')).toEqual({
      kind: 'blocked',
      reason: expect.stringContaining('grblHAL cannot parse'),
    });
  });

  it.each(['grbl-v1.1', 'grblhal'] as const)(
    'allows the finite float upper boundary and refuses overflow for %s',
    (kind) => {
      expect(encodeGrblSettingValue(30, 3.4028235e38, kind)).toEqual({
        kind: 'ok',
        value: `34028235${'0'.repeat(31)}`,
      });
      for (const input of [3.4028236e38, 1e39]) {
        expect(encodeGrblSettingValue(30, input, kind)).toEqual({
          kind: 'blocked',
          reason: expect.stringContaining('cannot store a finite value'),
        });
      }
    },
  );

  it('permits a non-zero grblHAL subnormal but refuses a decimal stored as zero', () => {
    expect(encodeGrblSettingValue(30, 1e-45, 'grblhal')).toEqual({
      kind: 'ok',
      value: `0.${'0'.repeat(44)}1`,
    });
    for (const input of [1e-46, 7.01e-46]) {
      expect(encodeGrblSettingValue(30, input, 'grblhal')).toEqual({
        kind: 'blocked',
        reason: 'grblHAL would store this non-zero decimal as zero.',
      });
    }
    expect(Math.fround(7.01e-46)).not.toBe(0);
    expect(encodeGrblSettingValue(30, 1e-9)).toEqual({
      kind: 'blocked',
      reason: 'Stock GRBL would store this non-zero decimal as zero.',
    });
  });

  it('does not confuse other firmware parsers or HAL integer datatypes with stock floats', () => {
    expect(encodeGrblSettingValue(30, 1e-8, 'fluidnc')).toEqual({
      kind: 'ok',
      value: '0.00000001',
    });
    expect(encodeGrblSettingValue(1, '65535.000000000', 'grblhal')).toEqual({
      kind: 'ok',
      value: '65535.000000000',
    });
  });

  it.each([Number.MIN_VALUE, Number.MAX_VALUE, '1e1000000', '1e-1000000', 1e39])(
    'refuses unsupported magnitude %s without an oversized expansion',
    (input) => expect(encodeGrblSettingValue(30, input).kind).toBe('blocked'),
  );

  it('keeps supported precision at the full command limit, then compacts a longer equivalent', () => {
    const value = `1.${'0'.repeat(74)}`;
    expect(encodeGrblSettingValue(1, value)).toEqual({ kind: 'ok', value });
    expect(encodeGrblSettingValue(130, value)).toEqual({ kind: 'ok', value: '1' });
    expect(encodeGrblSettingValue(30, `00001.${'0'.repeat(10000)}`)).toEqual({
      kind: 'ok',
      value: '1',
    });
  });

  it.each([
    '',
    ' ',
    'NaN',
    'Infinity',
    '0x10',
    '0b10',
    '1_000',
    '1\n$32=0',
    '1.2.3',
    NaN,
    Infinity,
    -Infinity,
  ])('refuses invalid numeric syntax %s', (input) =>
    expect(encodeGrblSettingValue(30, input).kind).toBe('blocked'),
  );
});
