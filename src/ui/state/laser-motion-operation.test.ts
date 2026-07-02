import { describe, expect, it } from 'vitest';
import { buildFrameJogLines } from './laser-motion-operation';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

describe('buildFrameJogLines', () => {
  it('emits the five XY perimeter legs with no Z word for laser framing', () => {
    const lines = buildFrameJogLines(BOUNDS, 1000);

    expect(lines).toEqual([
      '$J=G90 G21 X0.000 Y0.000 F1000\n',
      '$J=G90 G21 X10.000 Y0.000 F1000\n',
      '$J=G90 G21 X10.000 Y10.000 F1000\n',
      '$J=G90 G21 X0.000 Y10.000 F1000\n',
      '$J=G90 G21 X0.000 Y0.000 F1000\n',
    ]);
    expect(lines.some((line) => line.includes('Z'))).toBe(false);
  });

  it('prepends an absolute safe-Z retract before the XY legs when a safe height is provided', () => {
    const lines = buildFrameJogLines(BOUNDS, 1000, 3.81);

    expect(lines[0]).toBe('$J=G90 G21 Z3.810 F1000\n');
    expect(lines.slice(1)).toEqual(buildFrameJogLines(BOUNDS, 1000));
  });
});
