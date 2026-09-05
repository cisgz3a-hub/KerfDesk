import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';

describe('grblStrategy feed ceiling', () => {
  it('floors decimal feed words so output never exceeds the compiled ceiling', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'L1',
          color: '#ff0000',
          power: 50,
          speed: 1000.6,
          passes: 1,
          airAssist: false,
          segments: [
            {
              polyline: [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const output = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    expect(output).toContain('speed 1000 mm/min');
    expect(output).toContain('F1000');
    expect(output).not.toContain('F1001');
  });

  it('preserves a positive sub-1 feed without exceeding its ceiling', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'slow',
          color: '#ff0000',
          power: 10,
          speed: 0.75,
          passes: 1,
          airAssist: false,
          segments: [
            {
              polyline: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const output = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    expect(output).toContain('speed 0.75 mm/min');
    expect(output).toMatch(/\bF0\.75\b/);
    expect(output).not.toMatch(/\bF1(?:\D|$)/);
  });
});
