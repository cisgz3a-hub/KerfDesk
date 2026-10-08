import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { planAdaptivePocket } from './adaptive-pocket';
import { verifyAdaptivePocket } from './adaptive-pocket-verifier';
import { adaptivePocketContainmentIssue } from './adaptive-pocket-containment';
function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

describe('island-aware adaptive partition certification', () => {
  it.each([
    [square(0, 0, 30), square(10, 10, 10)],
    [square(0, 0, 40), square(8, 12, 8), square(24, 12, 8)],
    [square(0, 0, 40), square(8, 8, 24), square(14, 14, 12)],
  ])(
    'certifies original island boundaries, coverage and radial engagement for %j',
    (...contours) => {
      const plan = planAdaptivePocket(contours, 4, 0.5);
      if (!plan.ok) throw new Error(plan.reason);
      expect(plan.islandPartitions).toBeGreaterThan(1);
      expect(adaptivePocketContainmentIssue(contours, 2, plan)).toBeNull();
      const verification = verifyAdaptivePocket(contours, 4, plan);
      if (!verification.ok) throw new Error(JSON.stringify(verification));
      expect(verification).toMatchObject({ ok: true });
      if (verification.ok) expect(verification.coverageRatio).toBeGreaterThanOrEqual(0.985);
    },
  );
});
