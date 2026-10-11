import { describe, expect, it } from 'vitest';
import { commonConsoleStateEffect, hasAccessoryCommand } from './console-state-effect';

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

  it('separates motion from accessory-only and non-positional commands', () => {
    expect(commonConsoleStateEffect('G0 X10 Y10')).toBe('machine-state');
    for (const command of ['M3 S12000', 'M4 S500', 'M5', 'M7', 'M8', 'M9']) {
      expect(commonConsoleStateEffect(command)).toBe('accessories');
    }
    expect(commonConsoleStateEffect('G4 P1')).toBe('non-positional');
  });

  it('ignores command-looking text inside comments', () => {
    expect(commonConsoleStateEffect('G0 X1 (G92 Z0) ; G10 L20 P1 X0')).toBe('machine-state');
  });

  it.each(['G92 X0 T2', 'T2 G92 Y0', 'G92.1 G49', 'G55 T2', 'G10 L20 P1 X0 G43.1 Z5'])(
    'retains both coordinate and tool impacts for %s',
    (command) => expect(commonConsoleStateEffect(command)).toBe('coordinates-all'),
  );

  it.each(['G092 Z0', 'G 92 Z 0', 'G+92.000 Z+0', 'g 0 9 2 z 0', 'G92.0001 Z0'])(
    'recognizes equivalent coordinate words in %s',
    (command) => expect(commonConsoleStateEffect(command)).toBe('coordinates-z'),
  );

  it('normalizes all classified words without reading comments as commands', () => {
    expect(commonConsoleStateEffect('G010.0 L20 P1 X 0')).toBe('coordinates-xy');
    expect(commonConsoleStateEffect('G049.00')).toBe('tool');
    expect(commonConsoleStateEffect('G92.1001 G049')).toBe('coordinates-all');
    expect(commonConsoleStateEffect('G04.0 P1')).toBe('non-positional');
    expect(commonConsoleStateEffect('G001 X2 M003')).toBe('machine-state');
    expect(commonConsoleStateEffect('G092 Z0 (T2 X0) ; G55')).toBe('coordinates-z');
    expect(commonConsoleStateEffect('G92 X0 (T2)')).toBe('coordinates-xy');
    expect(commonConsoleStateEffect('G92 X0 (T2')).toBe('coordinates-xy');
    expect(hasAccessoryCommand('M 003.00 S500')).toBe(true);
    expect(hasAccessoryCommand('G1 X0 (M003) ; M009')).toBe(false);
  });
});
