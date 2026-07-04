import { describe, expect, it } from 'vitest';
import {
  isGcodeCommand,
  isGcodeMotionCommand,
  parseGcodeWord,
  stripGcodeComment,
} from './gcode-words';

describe('G-code word parsing', () => {
  it('parses common external numeric forms', () => {
    expect(parseGcodeWord('g1 x+1 y-.5 s1.', 'X')).toBe(1);
    expect(parseGcodeWord('g1 x+1 y-.5 s1.', 'Y')).toBe(-0.5);
    expect(parseGcodeWord('g1 x+1 y-.5 s1.', 'S')).toBe(1);
    expect(parseGcodeWord('G1 X1.2e2 Y-3E-1', 'X')).toBe(120);
    expect(parseGcodeWord('G1 X1.2e2 Y-3E-1', 'Y')).toBe(-0.3);
    expect(parseGcodeWord('G1X10Y.5', 'X')).toBe(10);
    expect(parseGcodeWord('G1X10Y.5', 'Y')).toBe(0.5);
  });

  it('ignores malformed or non-finite word values', () => {
    expect(parseGcodeWord('G1 X1e Y0', 'X')).toBeNull();
    expect(parseGcodeWord('G1 XInfinity', 'X')).toBeNull();
  });

  it('matches commands case-insensitively', () => {
    expect(isGcodeCommand('g1 x0', 'G1')).toBe(true);
    expect(isGcodeCommand('G1X10Y.5', 'G1')).toBe(true);
    expect(isGcodeCommand('G10 X0', 'G1')).toBe(false);
    expect(isGcodeMotionCommand('g3 x0 y0')).toBe(true);
    expect(isGcodeMotionCommand('g0x0y0')).toBe(true);
    expect(isGcodeMotionCommand('G10 X0')).toBe(false);
  });

  it('strips semicolon and parenthesized comments before word parsing', () => {
    const stripped = stripGcodeComment('G1 X5 (S0 comment) Y6 ; X0');

    expect(stripped).toBe('G1 X5   Y6');
    expect(parseGcodeWord(stripped, 'X')).toBe(5);
    expect(parseGcodeWord(stripped, 'Y')).toBe(6);
    expect(parseGcodeWord(stripped, 'S')).toBeNull();
    expect(stripGcodeComment('G1 X5 (unterminated S0')).toBe('G1 X5');
  });
});
