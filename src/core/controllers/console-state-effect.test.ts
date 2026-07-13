import { describe, expect, it } from 'vitest';
import { commonConsoleStateEffect } from './console-state-effect';

describe('commonConsoleStateEffect', () => {
  it('separates XY-only, Z-only, and full coordinate mutations', () => {
    expect(commonConsoleStateEffect('G92 X0 Y0')).toBe('coordinates-xy');
    expect(commonConsoleStateEffect('G10 L20 P1 Z15')).toBe('coordinates-z');
    expect(commonConsoleStateEffect('G10 L20 P1 X0 Z15')).toBe('coordinates-all');
    expect(commonConsoleStateEffect('G92.1')).toBe('coordinates-all');
    expect(commonConsoleStateEffect('G55')).toBe('coordinates-all');
  });

  it('recognizes tool identity and tool-length mutations', () => {
    for (const command of ['G43.1 Z-12.5', 'G49', 'T2 M6']) {
      expect(commonConsoleStateEffect(command)).toBe('tool');
    }
  });

  it('treats ordinary motion/modal commands as machine-state changes', () => {
    expect(commonConsoleStateEffect('G0 X10 Y10')).toBe('machine-state');
    expect(commonConsoleStateEffect('M3 S12000')).toBe('machine-state');
  });

  it('ignores command-looking text inside comments', () => {
    expect(commonConsoleStateEffect('G0 X1 (G92 Z0) ; G10 L20 P1 X0')).toBe('machine-state');
  });
});
