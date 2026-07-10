import { describe, expect, it } from 'vitest';
import { buildGrblFrameJogLines, buildGrblFrameRetract } from './frame-lines';

describe('buildGrblFrameRetract (MCH-12)', () => {
  it('is byte-identical to the old ui/state cncFrameRetractLine literal', () => {
    // $J=G90 G21 Z<z.3f> F<max(1,round(feed))>\n — the exact bytes the frame
    // path emitted before the retract literal moved behind the driver seam.
    expect(buildGrblFrameRetract(5, 1000)).toBe('$J=G90 G21 Z5.000 F1000\n');
  });

  it('rounds the feed up to at least 1 and formats Z to three decimals', () => {
    expect(buildGrblFrameRetract(2.5, 0.4)).toBe('$J=G90 G21 Z2.500 F1\n');
  });
});

describe('buildGrblFrameJogLines', () => {
  it('traces the five-leg absolute perimeter, each line newline-terminated', () => {
    const lines = buildGrblFrameJogLines({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 6000);
    expect(lines).toEqual([
      '$J=G90 G21 X0.000 Y0.000 F6000\n',
      '$J=G90 G21 X20.000 Y0.000 F6000\n',
      '$J=G90 G21 X20.000 Y10.000 F6000\n',
      '$J=G90 G21 X0.000 Y10.000 F6000\n',
      '$J=G90 G21 X0.000 Y0.000 F6000\n',
    ]);
  });
});
