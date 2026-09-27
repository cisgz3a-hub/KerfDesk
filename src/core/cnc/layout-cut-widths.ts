// Cut widths that lay out pocket and profile toolpaths and space relief
// roughing rings (ADR-368 Amendments 2 and 3).
//
// A layout needs two widths from its cutter:
//
//   wall      where the finished wall lands. Every depth pass of a profile or
//             pocket rides ONE path offset by half this width, the cut width
//             at the operation's full depth. The final pass's flank then
//             meets the drawn line at the stock surface and follows the bit
//             below it, and no pass reaches past the line: a shallower pass
//             on the same path cuts inside the final pass's sweep.
//   clearing  how far apart neighbouring rings or sweeps may run: the cut
//             width over one depth pass. A stepover percentage of it keeps
//             neighbouring grooves overlapping inside every pass, so no rib
//             stands between them.
//
// A flat end mill cuts its stored diameter at any depth, so both widths are
// that diameter, exactly as before. Every other cutter narrows toward its tip,
// and a pass engages it only up to the pass depth h:
//
//   ball nose          its sphere, 2 sqrt(h (D - h)), until h reaches its radius
//   V-bit, engraving   its cone and any tip flat, 2 r0 + 2 h tan(angle / 2)
//   tapered ball nose  ADR-368's ball and flank
//
// Each is the cutting surface the removal kernels stamp (sim/tool-kernels.ts),
// inverted, and is capped at the stored diameter where a cut runs past the
// modeled flutes. A cutter whose angle, tip flat or ball tip cannot be modeled
// keeps the stored diameter, the widest it can cut, so no wall passes the
// line; Job Review says so (cncLayoutFallsBackToStoredDiameter).

import { isValidCncTipAngleDeg } from '../cnc-tip-angle';
import { taperedBallEnvelope, taperedBallRadiusAtHeightMm } from '../cnc-tapered-ball';
import { assertNever, type CncTool } from '../scene';
import { zPassStepMm } from './depth-passes';
import { conicalRadialEnvelope, radialEnvelopeFootprintMm } from './radial-envelope';

export type CncLayoutCutWidths = {
  /** Diameter whose radius offsets the finished wall. */
  readonly wallDiameterMm: number;
  /** Diameter a stepover percentage spaces neighbouring rings or sweeps by. */
  readonly clearingDiameterMm: number;
};

// The radius a cutter cuts at a height above its tip, before the cap.
type CutRadiusAtHeight = (heightMm: number) => number;

/** Layout widths for a cut `depthMm` deep, taken `depthPerPassMm` at a time. */
export function cncLayoutCutWidths(
  tool: CncTool,
  depthMm: number,
  depthPerPassMm: number,
): CncLayoutCutWidths {
  const radiusAt = cutRadiusLaw(tool);
  if (radiusAt === null || !(depthMm > 0) || !Number.isFinite(depthMm)) {
    return { wallDiameterMm: tool.diameterMm, clearingDiameterMm: tool.diameterMm };
  }
  // The width a pass plunged this deep cuts at its top.
  const cutDiameterMm = (heightMm: number): number =>
    2 * Math.min(tool.diameterMm / 2, radiusAt(heightMm));
  return {
    wallDiameterMm: cutDiameterMm(depthMm),
    clearingDiameterMm: cutDiameterMm(zPassStepMm(depthMm, depthPerPassMm)),
  };
}

/**
 * True for a cutter that narrows toward its tip but whose angle, tip flat or
 * ball tip cannot be modeled, so its layout keeps the stored diameter.
 */
export function cncLayoutFallsBackToStoredDiameter(tool: CncTool): boolean {
  return tool.kind !== 'end-mill' && cutRadiusLaw(tool) === null;
}

// Null lays the cutter out at its stored diameter: exactly for a flat end
// mill, and as the conservative stand-in for a cutter that cannot be modeled.
function cutRadiusLaw(tool: CncTool): CutRadiusAtHeight | null {
  switch (tool.kind) {
    case 'end-mill':
      return null;
    case 'ball-nose':
      return ballRadiusLaw(tool.diameterMm / 2);
    case 'v-bit':
    case 'engraving':
      return conicalRadiusLaw(tool);
    case 'tapered-ball-nose': {
      const envelope = taperedBallEnvelope(tool);
      return envelope === null
        ? null
        : (heightMm) => taperedBallRadiusAtHeightMm(envelope, heightMm);
    }
    default:
      return assertNever(tool.kind, 'CncToolKind');
  }
}

// The kernel's sphere, R - sqrt(R^2 - r^2), inverted. From its equator up the
// flutes are a cylinder of the full radius.
function ballRadiusLaw(radiusMm: number): CutRadiusAtHeight | null {
  if (!(radiusMm > 0) || !Number.isFinite(radiusMm)) return null;
  return (heightMm) => {
    const h = Math.max(0, heightMm);
    return h >= radiusMm ? radiusMm : Math.sqrt(h * (2 * radiusMm - h));
  };
}

// Only a stored included angle defines the cone. The kernels and V-carve fall
// back to 60 degrees without one, but a layout that guessed would cut past the
// line with any wider bit, so it keeps the stored diameter instead. An
// engraving bit's explicit but invalid tip flat is unmodeled the same way.
function conicalRadiusLaw(tool: CncTool): CutRadiusAtHeight | null {
  const angleDeg = tool.tipAngleDeg;
  if (!isValidCncTipAngleDeg(angleDeg)) return null;
  const envelope = conicalRadialEnvelope(tool, angleDeg);
  return envelope === null ? null : (heightMm) => radialEnvelopeFootprintMm(envelope, heightMm);
}
