import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS, type Polyline } from '../scene';
import { cncOperationDesignBounds } from './cnc-design-bounds';
import { drillPeckPasses } from './drill-peck';

const layer = {
  ...createLayer({ id: 'pocket', color: '#123456' }),
  cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket' as const },
};
const bowtie: Polyline = {
  closed: true,
  points: [
    { x: 20, y: 20 },
    { x: 80, y: 80 },
    { x: 20, y: 80 },
    { x: 80, y: 20 },
  ],
};

describe('CNC filled artwork bounds', () => {
  it('keeps both lobes when their signed areas cancel', () => {
    expect(cncOperationDesignBounds([bowtie], [], layer, DEFAULT_DEVICE_PROFILE)).toEqual({
      minX: 20,
      minY: 20,
      maxX: 80,
      maxY: 80,
    });
  });

  it.each([
    { ...bowtie, closed: false },
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
        { x: 40, y: 40 },
      ],
    },
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 20, y: 0 },
        { x: 0, y: 0 },
      ],
    },
  ])('omits open and genuinely empty contours: %j', (polyline) => {
    expect(cncOperationDesignBounds([polyline], [], layer, DEFAULT_DEVICE_PROFILE)).toBeNull();
  });

  it('includes a collinear closed contour when Drill actually emits its centre hole', () => {
    const contour: Polyline = {
      closed: true,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 30, y: 30 },
      ],
    };
    expect(drillPeckPasses([contour], { depthMm: 1, depthPerPassMm: 1 })).toHaveLength(1);
    expect(
      cncOperationDesignBounds(
        [contour],
        [],
        {
          ...layer,
          cnc: { ...layer.cnc, cutType: 'drill' },
        },
        DEFAULT_DEVICE_PROFILE,
      ),
    ).toEqual({ minX: 10, minY: 10, maxX: 30, maxY: 30 });
  });
});
