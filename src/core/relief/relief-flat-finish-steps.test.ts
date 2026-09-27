import { describe, expect, it } from 'vitest';
import { flatFinishingStepPlans } from './relief-flat-finish-steps';
import type { ReliefFlatLevel } from './relief-flat-finish';

const flat = (zMm: number): ReliefFlatLevel => ({
  zMm,
  mask: new Uint8Array([1]),
  contours: [],
});

describe('separate flat finishing depth ownership', () => {
  it('starts above the allowance surface, not at a deeper ladder that never reached it', () => {
    const plans = flatFinishingStepPlans(
      [flat(-1)],
      [
        { zMm: -0.4, sliceTopMm: 0, bandFloorMm: null },
        { zMm: -0.6, sliceTopMm: -0.4, bandFloorMm: null },
      ],
      new Float32Array([-0.5]),
      0.2,
    );
    expect(plans[0]).toMatchObject({ sliceTopMm: -0.4, count: 3 });
  });

  it('checks the combined additional level array before expanding any flat', () => {
    expect(() =>
      flatFinishingStepPlans([flat(-1), flat(-1)], [], new Float32Array([0]), 3e-10),
    ).toThrow(/Relief roughing level count.*Array length/);
  });
});
