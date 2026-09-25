// Tapered ball-nose cutter geometry (ADR-368). A ball of `tipDiameterMm` sits
// at the tip and meets a conical flank tangentially; the flank opens at half
// the included `tipAngleDeg` until the cutter reaches `diameterMm`.
//
// With R the ball radius and α the per-side taper measured from the axis, the
// ball and flank touch at radius R·cos α and height R·(1 − sin α) above the
// tip. Below that radius the surface is the sphere R − sqrt(R² − r²); beyond
// it the flank rises 1/tan α per millimetre of radius. Height and slope match
// at the tangent point, so the profile is smooth and nondecreasing, which the
// relief dilation and removal stamping both rely on.
//
// Sellers list the PER-SIDE taper ("5.4° tapered angle", "single side
// degree"). KerfDesk stores the included angle like every other angled cutter,
// so a listed side angle is always doubled on entry (ADR-368 amends ADR-275
// item 6 for this flank).

import { isValidCncTipAngleDeg } from './cnc-tip-angle';
import { isValidCncTipDiameterMm } from './cnc-tip-diameter';
import type { CncTool } from './scene';

export type TaperedBallEnvelope = {
  readonly ballRadiusMm: number;
  /** tan of the per-side taper angle, measured from the tool axis. */
  readonly tanHalf: number;
  /** Where the ball meets the flank, measured from the tool axis and the tip. */
  readonly tangentRadiusMm: number;
  readonly tangentHeightMm: number;
  readonly outerRadiusMm: number;
};

/** A ball tip must exist and be narrower than the cut diameter it tapers to. */
export function isValidTaperedBallTipDiameterMm(
  value: unknown,
  toolDiameterMm: number,
): value is number {
  return isValidCncTipDiameterMm(value, toolDiameterMm) && value > 0;
}

/** The modeled envelope, or null when the stored geometry cannot define one. */
export function taperedBallEnvelope(tool: CncTool): TaperedBallEnvelope | null {
  if (tool.kind !== 'tapered-ball-nose') return null;
  const includedAngleDeg = tool.tipAngleDeg;
  const tipDiameterMm = tool.tipDiameterMm;
  if (!isValidCncTipAngleDeg(includedAngleDeg)) return null;
  if (!isValidTaperedBallTipDiameterMm(tipDiameterMm, tool.diameterMm)) return null;
  return envelopeFor(tipDiameterMm, includedAngleDeg, tool.diameterMm / 2);
}

/** Cutting-surface height above the tip at a radial distance from the axis. */
export function taperedBallHeightMm(envelope: TaperedBallEnvelope, radiusMm: number): number {
  const r = Math.max(0, radiusMm);
  if (r <= envelope.tangentRadiusMm) {
    const inside = Math.max(0, envelope.ballRadiusMm * envelope.ballRadiusMm - r * r);
    return envelope.ballRadiusMm - Math.sqrt(inside);
  }
  return envelope.tangentHeightMm + (r - envelope.tangentRadiusMm) / envelope.tanHalf;
}

/** Height above the tip at which the flank reaches the stored cut diameter. */
export function taperedBallCuttingLengthMm(envelope: TaperedBallEnvelope): number {
  return taperedBallHeightMm(envelope, envelope.outerRadiusMm);
}

/**
 * Cut diameter a tangent taper reaches at a listed flute length. Catalog
 * entries use it to turn a seller's tip, side angle, and cutting length into
 * the stored cut diameter; a length inside the ball returns the ball's own
 * width at that height.
 */
export function taperedBallDiameterAtHeightMm(
  tipDiameterMm: number,
  includedAngleDeg: number,
  heightMm: number,
): number {
  const envelope = envelopeFor(tipDiameterMm, includedAngleDeg, Number.POSITIVE_INFINITY);
  if (heightMm >= envelope.tangentHeightMm) {
    return (
      2 * (envelope.tangentRadiusMm + (heightMm - envelope.tangentHeightMm) * envelope.tanHalf)
    );
  }
  const ball = envelope.ballRadiusMm;
  const fromCenter = ball - Math.max(0, heightMm);
  return 2 * Math.sqrt(Math.max(0, ball * ball - fromCenter * fromCenter));
}

function envelopeFor(
  tipDiameterMm: number,
  includedAngleDeg: number,
  outerRadiusMm: number,
): TaperedBallEnvelope {
  const halfAngleRad = (includedAngleDeg * Math.PI) / 360;
  const ballRadiusMm = tipDiameterMm / 2;
  return {
    ballRadiusMm,
    tanHalf: Math.tan(halfAngleRad),
    tangentRadiusMm: ballRadiusMm * Math.cos(halfAngleRad),
    tangentHeightMm: ballRadiusMm * (1 - Math.sin(halfAngleRad)),
    outerRadiusMm,
  };
}
