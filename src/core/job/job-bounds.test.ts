import { describe, expect, it } from 'vitest';
import type { Job } from './job';
import { computeJobBounds } from './job-bounds';

const empty: Job = { groups: [] };

const job: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 30,
      speed: 1500,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 20 },
            { x: 100, y: 20 },
          ],
          closed: false,
        },
        {
          polyline: [
            { x: 50, y: 5 },
            { x: 50, y: 80 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

describe('computeJobBounds', () => {
  it('returns null for an empty job', () => {
    expect(computeJobBounds(empty)).toBeNull();
  });

  it('returns the AABB across all polylines', () => {
    expect(computeJobBounds(job)).toEqual({
      minX: 10,
      minY: 5,
      maxX: 100,
      maxY: 80,
    });
  });

  it('uses fill burn bounds without including overscan runway', () => {
    expect(
      computeJobBounds({
        groups: [
          {
            kind: 'fill',
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
                  { x: 10, y: 20 },
                  { x: 100, y: 20 },
                ],
                closed: false,
                reverse: false,
              },
            ],
          },
        ],
      }),
    ).toEqual({
      minX: 10,
      minY: 20,
      maxX: 100,
      maxY: 20,
    });
  });
});
