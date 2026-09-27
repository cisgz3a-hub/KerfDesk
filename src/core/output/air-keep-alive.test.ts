import { describe, expect, it } from 'vitest';
import {
  AIR_KEEP_ALIVE_SECONDS,
  moveSecondsUpperBound,
  withAirKeepAlive,
  type AirKeepAliveLimits,
} from './air-keep-alive';

// 60 mm/s moves with no acceleration term: every 60 mm of G1 costs exactly 1 s.
const LIMITS: AirKeepAliveLimits = { maxFeedMmPerMin: 36000, accelMmPerSec2: 0 };

/** `count` one-second burns along X, continuing from the `after`-th. */
function burns(count: number, after = 0): string[] {
  return Array.from({ length: count }, (_, index) => `G1 X${(after + index + 1) * 60}.000 S500`);
}

function program(lines: ReadonlyArray<string>): string {
  return `${lines.join('\n')}\n`;
}

function indicesOf(lines: ReadonlyArray<string>, word: string): number[] {
  return lines.flatMap((line, index) => (line === word ? [index] : []));
}

describe('withAirKeepAlive', () => {
  it('returns a program that never switches air on unchanged', () => {
    const source = program(['G21', 'G90', 'M4 S0', 'G1 X600.000 F3600 S500', 'M5']);

    expect(withAirKeepAlive(source, LIMITS)).toBe(source);
  });

  it('repeats at the estimated trigger on a sequence of one-second moves', () => {
    const source = program(['M4 S0', 'M8', 'G1 F3600', ...burns(12), 'M9', 'M5']);
    const lines = withAirKeepAlive(source, LIMITS).split('\n');

    // The repeat goes before the burn that starts once 5 s have run, and again 5 s later.
    expect(indicesOf(lines, 'M8')).toEqual([1, 8, 14]);
    expect(lines[9]).toBe('G1 X360.000 S500');
    expect(lines.slice(lines.indexOf('M9'))).toEqual(['M9', 'M5', '']);
  });

  it('repeats M7 when the program switched air on with M7', () => {
    const source = program(['M4 S0', 'M7', 'G1 F3600', ...burns(6), 'M9']);
    const lines = withAirKeepAlive(source, LIMITS).split('\n');

    expect(indicesOf(lines, 'M7')).toEqual([1, 8]);
    expect(lines).not.toContain('M8');
  });

  it('writes nothing after M9 and restarts the count at the next M8', () => {
    const source = program([
      'M4 S0',
      'M8',
      'G1 F3600',
      ...burns(4),
      'M9',
      ...burns(8, 4),
      'M8',
      ...burns(4, 12),
      'M9',
    ]);
    const lines = withAirKeepAlive(source, LIMITS).split('\n');

    expect(lines.filter((line) => /^M[789]$/.test(line))).toEqual(['M8', 'M9', 'M8', 'M9']);
  });

  it('holds a repeat under M3 until a laser-off move has left the beam dark', () => {
    const source = program([
      'M3 S0',
      'M8',
      'G1 F3600',
      ...burns(8),
      'G0 X0.000 Y10.000 S0',
      'G1 X60.000 S500',
      'M9',
    ]);
    const lines = withAirKeepAlive(source, LIMITS).split('\n');

    expect(indicesOf(lines, 'M8')).toEqual([1, 12]);
    expect(lines[11]).toBe('G0 X0.000 Y10.000 S0');
    expect(lines[13]).toBe('G1 X60.000 S500');
  });

  it('writes a repeat between two burns under M4, where a stop is dark', () => {
    const source = program(['M4 S0', 'M8', 'G1 F3600', ...burns(8), 'M9']);
    const lines = withAirKeepAlive(source, LIMITS).split('\n');

    const repeat = indicesOf(lines, 'M8')[1] ?? 0;

    expect(lines[repeat - 1]).toBe('G1 X300.000 S500');
  });

  it('counts a G4 dwell toward the interval', () => {
    const source = program(['M4 S0', 'M8', 'G4 P6', 'G1 X1.000 F3600 S0', 'M9']);

    expect(indicesOf(withAirKeepAlive(source, LIMITS).split('\n'), 'M8')).toEqual([1, 3]);
  });

  it('reads compact motion lines and ignores words inside comments', () => {
    const source = program([
      'M4 S0',
      'M8',
      'G1 F3600 S500',
      '; X99999 would be a 1666 s move if it were read',
      'X300.000',
      'X360.000 (X0 Y0)',
      'X420.000',
      'X480.000',
      'M9',
    ]);

    // Reading either comment would add seconds and move or add the repeat.
    expect(indicesOf(withAirKeepAlive(source, LIMITS).split('\n'), 'M8')).toEqual([1, 5]);
  });

  it('estimates an individual move from rest to rest under the supplied limits', () => {
    // 1 mm at 600 mm/s with 1000 mm/s^2 never reaches speed: a triangle.
    expect(moveSecondsUpperBound(1, 600, 1000)).toBeCloseTo(2 * Math.sqrt(1 / 1000), 12);
    // 100 mm at 10 mm/s is long enough to reach speed: cruise plus both ramps.
    expect(moveSecondsUpperBound(100, 10, 1000)).toBeCloseTo(100 / 10 + 10 / 1000, 12);
    expect(moveSecondsUpperBound(0, 10, 1000)).toBe(0);
    expect(moveSecondsUpperBound(10, 10, 0)).toBe(1);
  });

  it('uses an estimated trigger below the reported standby, without bounding repeat gaps', () => {
    // A chosen trigger is not a promise that an eligible boundary exists in
    // time. Long-block, dwell and M3-deferral cases pin that limitation separately.
    expect(AIR_KEEP_ALIVE_SECONDS * 4).toBeLessThanOrEqual(20);
  });
});
