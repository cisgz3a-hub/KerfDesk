import { describe, expect, it } from 'vitest';
import {
  rotaryAxisZeroLine,
  routeRotaryAxisLine,
  routeRotaryAxisLines,
} from './rotary-axis-output';

// ADR-693: the turn written as Y by every emitter goes out under A or Z.
describe('routeRotaryAxisLine', () => {
  it('renames Y words to the axis and leaves every other word', () => {
    expect(routeRotaryAxisLine('G1 X10.000 Y-2.500 F1500 S300', 'A')).toBe(
      'G1 X10.000 A-2.500 F1500 S300',
    );
    expect(routeRotaryAxisLine('G0X1Y.5', 'Z')).toBe('G0X1Z.5');
    expect(routeRotaryAxisLine('$J=G90 G21 X5.000 Y0.000 F600', 'A')).toBe(
      '$J=G90 G21 X5.000 A0.000 F600',
    );
  });

  it('never touches a comment', () => {
    expect(routeRotaryAxisLine('G1 Y5 ; Y stays Y5 here', 'A')).toBe('G1 A5 ; Y stays Y5 here');
    expect(routeRotaryAxisLine('(Y1 layer) G1 Y2', 'A')).toBe('(Y1 layer) G1 A2');
  });

  it('leaves letters that start no number, such as $HY', () => {
    expect(routeRotaryAxisLine('$HY', 'A')).toBe('$HY');
  });

  it('is a conflict when the line already uses the axis letter', () => {
    expect(routeRotaryAxisLine('G0 Z5', 'Z')).toBeNull();
    expect(routeRotaryAxisLine('G1 X1 A3', 'A')).toBeNull();
    expect(routeRotaryAxisLine('G0 Z5 ; fine for A', 'A')).toBe('G0 Z5 ; fine for A');
  });

  it('names the conflicting line in a program', () => {
    expect(routeRotaryAxisLines('G21\nG0 Y1\nG0 Z2\n', 'Z')).toEqual({
      kind: 'conflict',
      lineNumber: 3,
      line: 'G0 Z2',
    });
    expect(routeRotaryAxisLines('G21\nG0 Y1\n', 'A')).toEqual({ kind: 'ok', text: 'G21\nG0 A1\n' });
  });

  it('zeroes only the axis it names', () => {
    expect(rotaryAxisZeroLine('A')).toBe('G92 A0');
    expect(rotaryAxisZeroLine('Z')).toBe('G92 Z0');
  });
});
