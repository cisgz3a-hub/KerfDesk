// Cut widths that lay out pocket and profile toolpaths and space relief
// roughing rings (ADR-368 Amendment 2).
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
// For every cutter except a tapered ball nose both widths are the stored
// diameter, exactly as before. A tapered ball nose stores its widest diameter,
// at the top of its flutes (ADR-368), but a pass only engages it up to the
// pass depth, where the ball tip and taper cut far narrower. Its widths come
// from the ADR-368 law, capped at the stored diameter where a cut runs past
// the modeled flutes. One whose tip or taper cannot be modeled keeps the
// stored diameter: ADR-368 plans it as a flat cylinder of that size.

import {
  taperedBallEnvelope,
  taperedBallRadiusAtHeightMm,
  type TaperedBallEnvelope,
} from '../cnc-tapered-ball';
import type { CncTool } from '../scene';
import { zPassStepMm } from './depth-passes';

export type CncLayoutCutWidths = {
  /** Diameter whose radius offsets the finished wall. */
  readonly wallDiameterMm: number;
  /** Diameter a stepover percentage spaces neighbouring rings or sweeps by. */
  readonly clearingDiameterMm: number;
};

/** Layout widths for a cut `depthMm` deep, taken `depthPerPassMm` at a time. */
export function cncLayoutCutWidths(
  tool: CncTool,
  depthMm: number,
  depthPerPassMm: number,
): CncLayoutCutWidths {
  const envelope = taperedBallEnvelope(tool);
  if (envelope === null || !(depthMm > 0) || !Number.isFinite(depthMm)) {
    return { wallDiameterMm: tool.diameterMm, clearingDiameterMm: tool.diameterMm };
  }
  return {
    wallDiameterMm: cutDiameterAtDepthMm(envelope, depthMm),
    clearingDiameterMm: cutDiameterAtDepthMm(envelope, zPassStepMm(depthMm, depthPerPassMm)),
  };
}

// The width a pass plunged this deep cuts at its top: the cutting surface's
// radius at that height above the tip.
function cutDiameterAtDepthMm(envelope: TaperedBallEnvelope, depthMm: number): number {
  return 2 * Math.min(envelope.outerRadiusMm, taperedBallRadiusAtHeightMm(envelope, depthMm));
}
