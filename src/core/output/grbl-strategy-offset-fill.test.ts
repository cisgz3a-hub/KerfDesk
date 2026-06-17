import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';

describe('grblStrategy offset fill', () => {
  it('emits offset fill contours without scanline overscan runways', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          fillStyle: 'offset',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          airAssist: false,
          overscanMm: 5,
          segments: [
            {
              polyline: [
                { x: 10, y: 10 },
                { x: 20, y: 10 },
                { x: 20, y: 20 },
                { x: 10, y: 20 },
                { x: 10, y: 10 },
              ],
              closed: true,
            },
          ],
        },
      ],
    };
    const out = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);

    expect(out).toContain('; offset fill layer fill color #000000');
    expect(out).toContain('G0 X10.000 Y10.000 S0\nG1 X20.000 Y10.000 F1500 S300');
    expect(out).not.toContain('G0 X5.000 Y10.000 S0');
    expect(out).not.toContain('G0 X25.000 Y10.000 S0');
  });
});
