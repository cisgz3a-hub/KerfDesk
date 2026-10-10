// The cutter law every exact-contact solver shares (ADR-412, ADR-578): the
// kernel's radius with a rounding allowance, its surface law clamped at that
// radius, and the closed-form profile that tells the facet and edge solvers in
// heightmap-surface-contact-geometry.ts where a maximum can lie.

import { taperedBallEnvelope } from '../cnc-tapered-ball';
// Deep imports: the legacy core/cnc barrel is frozen by the export ratchet.
import { vcarveIncludedAngleDeg } from '../cnc/vcarve-angle';
import { conicalRadialEnvelope } from '../cnc/radial-envelope';
import type { ToolKernel } from '../sim';
import type { ContactLaw, ContactProfile } from './heightmap-surface-contact-geometry';

const FALLBACK_V_TIP_ANGLE_DEG = 60;

/** A fresh law (with its own scratch) for one kernel, or null for no cutter. */
export function surfaceContactLaw(kernel: ToolKernel): ContactLaw | null {
  if (!(kernel.radiusMm > 0) || !Number.isFinite(kernel.radiusMm)) return null;
  const tolerance = 16 * Number.EPSILON * Math.max(1, kernel.radiusMm, kernel.mmPerCell);
  const radiusMm = kernel.radiusMm + tolerance;
  return {
    radiusMm,
    radiusSquared: radiusMm * radiusMm,
    dz: (distanceMm: number): number =>
      kernel.surfaceDzAtRadius(Math.min(kernel.radiusMm, distanceMm)),
    profile: contactProfileFor(kernel),
    roots: new Float64Array(6),
    facet: { planeBound: 0, candidate: 0, insideRectangle: 0 },
  };
}

export function contactProfileFor(kernel: ToolKernel): ContactProfile {
  const tool = kernel.tool;
  const growth = kernel.horizontalGrowthMm;
  switch (tool.kind) {
    case 'end-mill':
      return { kind: 'flat' };
    case 'ball-nose':
      return growth === 0 ? { kind: 'ball', ball: kernel.radiusMm } : { kind: 'search' };
    case 'v-bit':
    case 'engraving': {
      const envelope = conicalRadialEnvelope(
        tool,
        vcarveIncludedAngleDeg(tool) ?? FALLBACK_V_TIP_ANGLE_DEG,
      );
      if (envelope === null) return { kind: 'flat' };
      return { kind: 'cone', land: envelope.tipRadiusMm + growth, slope: 1 / envelope.tanHalf };
    }
    case 'tapered-ball-nose': {
      const envelope = taperedBallEnvelope(tool);
      if (envelope === null) return { kind: 'flat' };
      return growth === 0
        ? {
            kind: 'tapered',
            ball: envelope.ballRadiusMm,
            tangentRadius: envelope.tangentRadiusMm,
            slope: 1 / envelope.tanHalf,
          }
        : { kind: 'search' };
    }
    default:
      return { kind: 'search' };
  }
}
