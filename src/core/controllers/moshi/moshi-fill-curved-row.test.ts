// Audit of the last 200 PRs (#1757): a taper-warped Fill row keeps its
// interior points as `via` (ADR-694 Amendment 1). The G-code Fill burned
// through them; the Moshi planner burned only the chord.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../devices';
import type { FillGroup } from '../../job';
import { planFillGroupSteps } from './moshi-fill-plan';
import { toMils } from './moshi-units';

const MOSHI: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'moshi' };

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

describe('Moshi Fill on a curved row', () => {
  it('burns through the row interior points', () => {
    const steps = planFillGroupSteps(curved, MOSHI);
    expect(steps).toContainEqual({ ...toMils({ x: 60, y: 10.5 }), cut: true });
  });
});
