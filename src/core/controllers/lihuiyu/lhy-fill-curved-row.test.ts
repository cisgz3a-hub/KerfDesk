// Audit of the last 200 PRs (#1757): a taper-warped Fill row keeps its
// interior points as `via` (ADR-694 Amendment 1). The G-code Fill burned
// through them; the K40 planner burned only the chord.
import { describe, expect, it } from 'vitest';
import type { FillGroup } from '../../job';
import { lhyPoint, planLhyPart } from './lhy-motion-plan';

const curved: FillGroup = {
  kind: 'fill',
  layerId: 'F',
  color: '#00f',
  power: 40,
  speed: 3000,
  passes: 1,
  airAssist: false,
  overscanMm: 0,
  segments: [
    {
      polyline: [
        { x: 50, y: 10 },
        { x: 60, y: 10.5 },
        { x: 70, y: 10 },
      ],
      closed: false,
      reverse: false,
    },
  ],
};

describe('K40 Fill on a curved row', () => {
  it('burns through the row interior points', () => {
    const part = planLhyPart(curved, 0);
    const middle = lhyPoint({ x: 60, y: 10.5 });
    expect(part?.steps).toContainEqual({ ...middle, burn: true });
  });
});
