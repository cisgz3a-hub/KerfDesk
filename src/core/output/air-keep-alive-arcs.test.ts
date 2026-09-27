import { describe, expect, it } from 'vitest';
import { withAirKeepAlive } from './air-keep-alive';

const LIMITS = { maxFeedMmPerMin: 36000, accelMmPerSec2: 0 };
const NEXT_MOVE = 'G1 X11 Y0 S0';

describe('air repeat accounting for G17 arcs', () => {
  it.each([
    ['clockwise full circle', 'G2 X10 Y0 I-10 J0 F60 S500', 20 * Math.PI],
    ['counter-clockwise full circle', 'G3 X10 Y0 I-10 J0 F60 S500', 20 * Math.PI],
    ['center-only full circle', 'G2 I-10 J0 F60 S500', 20 * Math.PI],
    ['large I/J arc', 'G2 X0 Y10 I-10 J0 F60 S500', 15 * Math.PI],
    ['large negative-R arc', 'G3 X0 Y10 R-10 F60 S500', 15 * Math.PI],
    ['minor positive-R arc', 'G3 X0 Y10 R10 F60 S500', 5 * Math.PI],
    ['modal large arc', 'G2 F60 S500\nX0 Y10 I-10 J0', 15 * Math.PI],
  ] as const)('counts the path length of a %s instead of its chord', (_label, arc, seconds) => {
    // Radius 10 mm at F60 is 1 mm/s: a circle is 20π s, a 270° arc
    // is 15π s, and a 90° arc is 5π s. No production timing oracle.
    const source = ['M4 S0', 'G0 X10 Y0', 'M8', arc, NEXT_MOVE, 'M9', ''].join('\n');
    const beforeThreshold = withAirKeepAlive(source, LIMITS, seconds + 0.01);
    const afterThreshold = withAirKeepAlive(source, LIMITS, seconds - 0.01);

    expect(beforeThreshold).toBe(source);
    expect(afterThreshold).toBe(source.replace(`\n${NEXT_MOVE}`, `\nM8\n${NEXT_MOVE}`));
  });

  it('treats a center-only full circle as an eligible next motion boundary', () => {
    const source = 'M4 S0\nG0 X10 Y0\nM8\nG4 P6\nG2 I-10 J0 F60 S500\nM9\n';

    expect(withAirKeepAlive(source, LIMITS)).toBe(source.replace('\nG2 I-10', '\nM8\nG2 I-10'));
  });
});
