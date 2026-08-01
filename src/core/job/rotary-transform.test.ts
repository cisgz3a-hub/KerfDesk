import { describe, expect, it } from 'vitest';

import type { Job } from './job';
import { applyRotaryYScale } from './rotary-transform';

describe('applyRotaryYScale', () => {
  it('retains compile diagnostics while mapping machine-space geometry', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'line',
          color: '#000000',
          power: 10,
          speed: 1000,
          passes: 1,
          airAssist: false,
          segments: [
            {
              closed: false,
              polyline: [
                { x: 0, y: 10 },
                { x: 10, y: 20 },
              ],
            },
          ],
        },
      ],
      diagnostics: [{ kind: 'offset-fill-pass-limit', layerName: 'Fill', passLimit: 2000 }],
    };

    expect(applyRotaryYScale(job, 2).diagnostics).toEqual(job.diagnostics);
  });
});
