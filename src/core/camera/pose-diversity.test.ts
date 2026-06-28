import { describe, expect, it } from 'vitest';
import type { ViewExtrinsics } from './calibrate';
import { checkPoseDiversity } from './pose-diversity';

const DIVERSE: ViewExtrinsics[] = [
  { rvec: [0.02, -0.02, 0], tvec: [0, 0, 600] },
  { rvec: [0.45, 0, 0], tvec: [10, -5, 640] },
  { rvec: [0, 0.5, 0], tvec: [-8, 6, 660] },
  { rvec: [0.3, -0.35, 0.2], tvec: [5, 5, 620] },
  { rvec: [-0.4, 0.25, -0.15], tvec: [-6, -4, 680] },
];

describe('checkPoseDiversity', () => {
  it('accepts genuinely tilted poses', () => {
    const verdict = checkPoseDiversity(DIVERSE);
    expect(verdict.kind).toBe('ok');
    expect(verdict.maxSpreadRad).toBeGreaterThan(0.15);
  });

  it('rejects five near-identical poses (the focal/depth-ambiguity trap)', () => {
    const base: ViewExtrinsics = { rvec: [0.02, -0.02, 0], tvec: [0, 0, 600] };
    const clustered = Array.from({ length: 5 }, () => base);
    const verdict = checkPoseDiversity(clustered);
    expect(verdict.kind).toBe('insufficient-pose-diversity');
    expect(verdict.maxSpreadRad).toBeLessThan(0.15);
  });

  it('rejects a single pose', () => {
    expect(checkPoseDiversity([DIVERSE[0] as ViewExtrinsics]).kind).toBe(
      'insufficient-pose-diversity',
    );
  });

  it('measures the geodesic angle, not raw rvec distance', () => {
    // Two rotations about the same axis differing by ~0.3 rad must read ~0.3 rad.
    const verdict = checkPoseDiversity([
      { rvec: [0.1, 0, 0], tvec: [0, 0, 600] },
      { rvec: [0.4, 0, 0], tvec: [0, 0, 600] },
    ]);
    expect(verdict.maxSpreadRad).toBeCloseTo(0.3, 6);
  });
});
