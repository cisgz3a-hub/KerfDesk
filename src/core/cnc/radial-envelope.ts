import { isValidCncTipDiameterMm } from '../cnc-tip-diameter';
import type { CncTool } from '../scene';

/** A monotone conical cutter envelope measured from its lowest cutting plane. */
export type RadialEnvelope = {
  readonly tanHalf: number;
  readonly tipRadiusMm: number;
  readonly outerRadiusMm: number;
};

/** Resolve pointed and flat-tip conical tools through the same radial law. */
export function conicalRadialEnvelope(
  tool: CncTool,
  includedAngleDeg: number,
): RadialEnvelope | null {
  const tanHalf = Math.tan((includedAngleDeg * Math.PI) / 360);
  if (!(tanHalf > 0) || !Number.isFinite(tanHalf)) return null;
  const outerRadiusMm =
    Number.isFinite(tool.diameterMm) && tool.diameterMm > 0
      ? tool.diameterMm / 2
      : Number.POSITIVE_INFINITY;
  if (
    tool.kind === 'engraving' &&
    tool.tipDiameterMm !== undefined &&
    !isValidCncTipDiameterMm(tool.tipDiameterMm, tool.diameterMm)
  ) {
    return null;
  }
  const tipRadiusMm =
    tool.kind === 'engraving' && isValidCncTipDiameterMm(tool.tipDiameterMm, tool.diameterMm)
      ? tool.tipDiameterMm / 2
      : 0;
  return { tanHalf, tipRadiusMm, outerRadiusMm };
}

/** r(h) = r0 + h tan(alpha); callers cap h at radialEnvelopeMaxDepthMm. */
export function radialEnvelopeFootprintMm(envelope: RadialEnvelope, depthMm: number): number {
  return envelope.tipRadiusMm + Math.max(0, depthMm) * envelope.tanHalf;
}

/** h(d) = max(0, (d - r0) / tan(alpha)); a sub-tip clearance cannot be cut. */
export function radialEnvelopeDepthMm(envelope: RadialEnvelope, clearanceMm: number): number {
  if (!(clearanceMm > envelope.tipRadiusMm)) return 0;
  return (clearanceMm - envelope.tipRadiusMm) / envelope.tanHalf;
}

/** Cutting-surface height at a radial distance; shared by CAM and simulation. */
export function radialEnvelopeHeightMm(envelope: RadialEnvelope, radiusMm: number): number {
  return radialEnvelopeDepthMm(envelope, radiusMm);
}

/** Maximum flank depth before the cutter reaches its full outer radius. */
export function radialEnvelopeMaxDepthMm(envelope: RadialEnvelope): number {
  return (envelope.outerRadiusMm - envelope.tipRadiusMm) / envelope.tanHalf;
}

/** Removed radius for an isolated depth sample; Z=0 removes no negative material. */
export function radialEnvelopeRemovalRadiusMm(envelope: RadialEnvelope, depthMm: number): number {
  return depthMm > 0 ? radialEnvelopeFootprintMm(envelope, depthMm) : 0;
}

/** Affine endpoint radii for one swept XYZ chord. */
export function radialEnvelopeSweepRadiiMm(
  envelope: RadialEnvelope,
  depthA: number,
  depthB: number,
): readonly [number, number] {
  if (!(depthA > 0) && !(depthB > 0)) return [0, 0];
  return [radialEnvelopeFootprintMm(envelope, depthA), radialEnvelopeFootprintMm(envelope, depthB)];
}
