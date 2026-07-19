import { describe, expect, it } from 'vitest';
import type { Job } from './job';
import { buildToolpath } from './toolpath';

describe('buildToolpath pass parity', () => {
  it('repeats Cut/Line routes for every emitted pass', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'line',
          color: '#000',
          power: 30,
          speed: 1000,
          passes: 2,
          airAssist: false,
          segments: [
            {
              polyline: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };

    const toolpath = buildToolpath(job);
    expect(toolpath.steps.map((step) => step.kind)).toEqual(['cut', 'travel', 'cut']);
    expect(toolpath.steps.filter((step) => step.kind === 'cut')).toHaveLength(2);
    expect(toolpath.totalLength).toBe(30);
  });

  it('repeats reverse Scanline Fill routes for every emitted pass', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000',
          power: 30,
          speed: 1000,
          passes: 2,
          airAssist: false,
          overscanMm: 0,
          segments: [
            {
              polyline: [
                { x: 20, y: 5 },
                { x: 10, y: 5 },
              ],
              closed: false,
              reverse: true,
            },
          ],
        },
      ],
    };

    const toolpath = buildToolpath(job);
    expect(toolpath.steps.map((step) => step.kind)).toEqual(['cut', 'travel', 'cut']);
    expect(toolpath.steps.filter((step) => step.kind === 'cut')).toHaveLength(2);
    expect(toolpath.totalLength).toBe(30);
  });
});
