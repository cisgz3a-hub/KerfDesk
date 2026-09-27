import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { type Job } from '../job';
import { grblStrategy } from './grbl-strategy';

function emit(job: Job): string {
  // Pin the readable spelling; compact equivalence is covered by grbl-fill-compaction.test.
  return grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE, { compactMotionWords: false });
}

function hasZeroLengthMove(gcode: string): boolean {
  let x: number | undefined;
  let y: number | undefined;
  for (const line of gcode.split('\n')) {
    const code = line.split(';')[0] ?? '';
    const nextX = code.match(/X([-\d.]+)/);
    const nextY = code.match(/Y([-\d.]+)/);
    if (nextX === null && nextY === null) {
      // A compact writer can omit both unchanged axes. A regressed span guard
      // then leaves a bare S300 (or G1S300), still arming power without motion.
      const power = code.match(/S([-+\d.]+)/);
      if (power !== null && Number(power[1]) > 0) return true;
      continue;
    }
    const targetX = nextX === null ? x : Number(nextX[1]);
    const targetY = nextY === null ? y : Number(nextY[1]);
    if (targetX === x && targetY === y) return true;
    x = targetX;
    y = targetY;
  }
  return false;
}

describe('grblStrategy fill zero-length / coincident span guard (audit 2026-06-03)', () => {
  it('merges two touching spans into one continuous burn (no zero-length gap G1)', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          airAssist: false,
          overscanMm: 0,
          segments: [
            {
              polyline: [
                { x: 0, y: 5 },
                { x: 5, y: 5 },
              ],
              closed: false,
              reverse: false,
            },
            {
              polyline: [
                { x: 5, y: 5 },
                { x: 10, y: 5 },
              ],
              closed: false,
              reverse: false,
            }, // touches the first at x=5
          ],
        },
      ],
    };
    const out = emit(job);
    expect(hasZeroLengthMove(out)).toBe(false);
    // Touching spans burn as one continuous run; no S0 gap is emitted at x=5.
    expect(out).not.toMatch(/G1 X5\.000 Y5\.000 S0/);
    expect(out).toContain('G1 X5.000 Y5.000 F1500 S300\nG1 X10.000 Y5.000 S300');
  });

  it('drops a degenerate interior span instead of emitting a stationary beam-on G1', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          airAssist: false,
          overscanMm: 0,
          segments: [
            {
              polyline: [
                { x: 0, y: 3 },
                { x: 5, y: 3 },
              ],
              closed: false,
              reverse: false,
            },
            {
              polyline: [
                { x: 8, y: 3 },
                { x: 8, y: 3 },
              ],
              closed: false,
              reverse: false,
            }, // degenerate (zero-length)
            {
              polyline: [
                { x: 10, y: 3 },
                { x: 15, y: 3 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
      ],
    };
    const out = emit(job);
    expect(hasZeroLengthMove(out)).toBe(false);
    // No stationary positive-S move at the degenerate span's coordinate.
    expect(out).not.toMatch(/G1 X8\.000 Y3\.000 S300/);
  });
});
