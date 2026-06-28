import { describe, expect, it } from 'vitest';
import { buildToolpath } from './toolpath';

describe('buildToolpath Island Fill motion policy', () => {
  it('renders sensitive Island Fill with full configured runway in the preview route', () => {
    const tp = buildToolpath({
      groups: [
        {
          kind: 'fill',
          fillStyle: 'island',
          islandMotionPolicy: 'sensitive',
          layerId: 'fill',
          color: '#000',
          power: 30,
          speed: 1000,
          passes: 1,
          airAssist: false,
          overscanMm: 5,
          segments: [
            {
              polyline: [
                { x: 10, y: 5 },
                { x: 13, y: 5 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
      ],
    });

    expect(tp.steps.map((step) => step.kind)).toEqual(['travel', 'cut', 'travel']);
    expect(tp.steps[0]).toMatchObject({
      kind: 'travel',
      from: { x: 5, y: 5 },
      to: { x: 10, y: 5 },
      length: 5,
    });
    expect(tp.steps[2]).toMatchObject({
      kind: 'travel',
      from: { x: 13, y: 5 },
      to: { x: 18, y: 5 },
      length: 5,
    });
  });
});
