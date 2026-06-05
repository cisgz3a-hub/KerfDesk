import { describe, expect, it } from 'vitest';
import type { Job } from './job';
import { applyJobOrigin, offsetJobBounds, USER_ORIGIN_JOB_PLACEMENT } from './job-origin';
import { computeJobBounds } from './job-bounds';

const centeredJob: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 10,
      speed: 1500,
      passes: 1,
      segments: [
        {
          closed: true,
          polyline: [
            { x: 175, y: 215 },
            { x: 225, y: 215 },
            { x: 225, y: 185 },
            { x: 175, y: 185 },
            { x: 175, y: 215 },
          ],
        },
      ],
    },
  ],
};

describe('applyJobOrigin', () => {
  it('moves the lower-left job bounds anchor to work coordinate 0,0 for user origin jobs', () => {
    const adjusted = applyJobOrigin(centeredJob, USER_ORIGIN_JOB_PLACEMENT);

    expect(computeJobBounds(adjusted)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 50,
      maxY: 30,
    });
    expect(adjusted.groups[0]?.kind).toBe('cut');
  });

  it('moves the selected anchor to the current work position for current-position jobs', () => {
    const adjusted = applyJobOrigin(centeredJob, {
      startFrom: 'current-position',
      anchor: 'center',
      currentPosition: { x: 120, y: 80 },
    });

    expect(computeJobBounds(adjusted)).toEqual({
      minX: 95,
      minY: 65,
      maxX: 145,
      maxY: 95,
    });
  });
});

describe('offsetJobBounds', () => {
  it('converts work-coordinate job bounds into physical machine bounds using WCO', () => {
    expect(offsetJobBounds({ minX: 0, minY: 0, maxX: 50, maxY: 30 }, { x: 380, y: 390 })).toEqual({
      minX: 380,
      minY: 390,
      maxX: 430,
      maxY: 420,
    });
  });
});
