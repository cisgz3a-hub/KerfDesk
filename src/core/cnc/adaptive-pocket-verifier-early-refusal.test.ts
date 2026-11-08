// S8-P3-2: the verdict checks engagement first, so the first move above the
// limit settles a refusal. The verifier stops there instead of simulating the
// rest of the plan, and gives the same reason. Counted, not timed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Polyline } from '../scene';
import { planAdaptivePocket, type AdaptivePocketPlan } from './adaptive-pocket';
import { AdaptiveCutterContact } from './adaptive-pocket-contact';
import { verifyAdaptivePocket } from './adaptive-pocket-verifier';

afterEach(() => {
  vi.restoreAllMocks();
});

function rectangle(width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
  };
}

// Each roughing ring is joined from the last point cut, then cut move by move.
function roughingMoves(plan: Extract<AdaptivePocketPlan, { ok: true }>): number {
  return plan.sequences.reduce(
    (sum, sequence) => sum + sequence.rings.reduce((moves, ring) => moves + ring.points.length, 0),
    0,
  );
}

describe('verifyAdaptivePocket refusal (S8-P3-2)', () => {
  it('stops at the first move over the engagement limit', () => {
    const contours = [rectangle(60, 40)];
    const plan = planAdaptivePocket(contours, 6, 0.6);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const moves = vi.spyOn(AdaptiveCutterContact.prototype, 'addMove');
    const result = verifyAdaptivePocket(contours, 6, plan);
    expect(result).toMatchObject({
      ok: false,
      reason: 'Adaptive verification simulated radial engagement above the configured limit.',
    });
    // Main simulated every roughing move of the plan before refusing.
    expect(moves.mock.calls.length).toBeLessThan(roughingMoves(plan) / 10);
  });

  it('still simulates every move of a plan it accepts', () => {
    const contours = [rectangle(20, 20)];
    const plan = planAdaptivePocket(contours, 6, 0.6);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const moves = vi.spyOn(AdaptiveCutterContact.prototype, 'addMove');
    expect(verifyAdaptivePocket(contours, 6, plan)).toMatchObject({ ok: true });
    expect(moves.mock.calls.length).toBeGreaterThanOrEqual(roughingMoves(plan));
  });
});
