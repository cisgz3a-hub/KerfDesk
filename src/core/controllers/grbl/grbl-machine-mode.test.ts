import { describe, expect, it } from 'vitest';
import { isLaserModeEnabled, parseGrblMachineMode } from './grbl-machine-mode';

describe('parseGrblMachineMode', () => {
  // The regression this module exists for: grblHAL's $32 is a three-way
  // "Mode of operation" enum, not grbl's laser-mode boolean. A lathe reports
  // $32=2, and reading it as a boolean threw that value away.
  it('reads a grblHAL lathe from $32=2', () => {
    expect(parseGrblMachineMode('2')).toEqual({ kind: 'lathe' });
  });

  it('reads the two values every grbl-family firmware can report', () => {
    expect(parseGrblMachineMode('0')).toEqual({ kind: 'standard' });
    expect(parseGrblMachineMode('1')).toEqual({ kind: 'laser' });
  });

  // "The controller never reported $32" and "the controller reported a value
  // we cannot map to a mode" are different facts and must not collapse.
  it('separates an absent $32 from an unrecognized $32', () => {
    expect(parseGrblMachineMode(undefined)).toBeUndefined();
    expect(parseGrblMachineMode('')).toBeUndefined();
    expect(parseGrblMachineMode('   ')).toBeUndefined();
    expect(parseGrblMachineMode('7')).toEqual({ kind: 'unrecognized', raw: '7' });
    expect(parseGrblMachineMode('abc')).toEqual({ kind: 'unrecognized', raw: 'abc' });
    expect(parseGrblMachineMode('-1')).toEqual({ kind: 'unrecognized', raw: '-1' });
  });

  it('accepts the decimal formatting a $$ dump may use', () => {
    expect(parseGrblMachineMode('2.000')).toEqual({ kind: 'lathe' });
    expect(parseGrblMachineMode(' 1 ')).toEqual({ kind: 'laser' });
  });

  // Firmware truncates a float into an integer before applying $32, but no
  // firmware ever REPORTS a fractional mode. Guessing which side to round to
  // would be inventing a fact, so keep it unproven instead.
  it('does not round a fractional value into a mode', () => {
    expect(parseGrblMachineMode('1.5')).toEqual({ kind: 'unrecognized', raw: '1.5' });
  });

  it('preserves the raw text of an unrecognized value for operator-facing text', () => {
    expect(parseGrblMachineMode('9')).toEqual({ kind: 'unrecognized', raw: '9' });
  });
});

describe('isLaserModeEnabled', () => {
  // grblHAL stores ONE mode enum, so Mode_Lathe is proof that laser mode is
  // off — a known false, not an unknown.
  it('is false for a lathe, which is provably not in laser mode', () => {
    expect(isLaserModeEnabled({ kind: 'lathe' })).toBe(false);
  });

  it('maps the boolean-era modes unchanged', () => {
    expect(isLaserModeEnabled({ kind: 'standard' })).toBe(false);
    expect(isLaserModeEnabled({ kind: 'laser' })).toBe(true);
  });

  it('stays unproven for a value whose meaning no firmware defines', () => {
    expect(isLaserModeEnabled({ kind: 'unrecognized', raw: '7' })).toBeUndefined();
  });
});
