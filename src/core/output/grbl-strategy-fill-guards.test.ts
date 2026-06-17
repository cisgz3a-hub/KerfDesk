import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { type Job } from '../job';
import { grblStrategy } from './grbl-strategy';

function emit(job: Job): string {
  return grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
}

function hasZeroLengthMove(gcode: string): boolean {
  let prev = '';
  for (const line of gcode.split('\n')) {
    if (!/^G[01] /.test(line)) continue;
    const coord = (line.match(/X[-\d.]+ Y[-\d.]+/) ?? [''])[0];
    if (coord !== '' && coord === prev) return true;
    prev = coord;
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
