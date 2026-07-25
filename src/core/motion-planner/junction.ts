// Junction-deviation cornering limit (extracted from core/job/planner.ts,
// ADR-255 stage 8a — pure move, no behavior change).

import { blockMotion, type Block } from './block';

// Sonny Jeon's junction-deviation formula. θ is the angle between the
// previous block's direction and the next block's direction.
// sin(θ/2) is computed from the dot product without an explicit acos.
export function junctionVelocity(prev: Block, next: Block, accel: number, jd: number): number {
  // Rapid and feed motion retain the estimator's conservative stop boundary.
  // Laser state is not a motion boundary: G1/S0 feed travel blends through a
  // powered G1 span exactly as the emitted continuous sweep does.
  if (blockMotion(prev) !== blockMotion(next) && !isContinuousFeedMatchedLaserJunction(prev, next))
    return 0;
  const cosTheta = prev.direction.x * next.direction.x + prev.direction.y * next.direction.y;
  // Clamp to handle float noise just outside [-1, 1].
  const clamped = Math.min(1, Math.max(-1, cosTheta));
  // Sonny Jeon's junction-deviation half-angle. θ is the DEVIATION angle
  // (0 = straight, π = reversal); GRBL derives sin(θ/2) from the NEGATED
  // dot product, so sin(θ/2) = √((1 + cosTheta) / 2) with cosTheta = prev·next:
  //   straight (cosTheta = +1) → sin = 1 → v_j → ∞ (caller mins against target)
  //   reversal (cosTheta = −1) → sin = 0 → v_j = 0 (must stop)
  // The √((1 − cosTheta)/2) form is inverted: it collapses to ~0 velocity on
  // gentle turns and BLOWS UP toward ∞ on near-reversals, so float noise that
  // nudged a 180° corner off exactly −1 removed the required full stop.
  const sinHalf = Math.sqrt((1 + clamped) / 2);
  if (sinHalf >= 1) return Number.POSITIVE_INFINITY; // straight
  if (sinHalf <= 0) return 0; // reversal
  return Math.sqrt((accel * jd * sinHalf) / (1 - sinHalf));
}

function isContinuousFeedMatchedLaserJunction(prev: Block, next: Block): boolean {
  return (
    prev.feedMatchedLaserMotion === true &&
    next.feedMatchedLaserMotion === true &&
    prev.targetVelocity === next.targetVelocity
  );
}
