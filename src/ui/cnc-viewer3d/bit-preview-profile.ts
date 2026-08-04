// A catalog preview uses the simulator profile verbatim. The profile's
// vertical stub is only a display aid at cutter radius: without cutting length
// or transition-height metadata, stepping it to a catalog shank diameter could
// falsely enlarge or neck the cutting tip. The UI reports shank diameter as
// metadata instead of inventing that transition.

import { isValidCncTipAngleDeg } from '../../core/cnc-tip-angle';
import { isValidCncTipDiameterMm } from '../../core/cnc-tip-diameter';
import type { CncTool } from '../../core/scene';
import { toolProfile, type ToolProfilePoint } from '../../core/sim';

export function bitPreviewProfile(tool: CncTool): ReadonlyArray<ToolProfilePoint> {
  const issue = bitPreviewGeometryIssue(tool);
  if (issue !== null) throw new Error(issue);
  return toolProfile(tool);
}

export function bitPreviewGeometryIssue(tool: CncTool): string | null {
  if (tool.kind === 'engraving') {
    // An engraving bit is a truncated cone: the included angle gives the flank,
    // and tipDiameterMm the flat land at the tip (absent = a true point, like a
    // v-bit). Before that field existed there was genuinely nothing truthful to
    // model, so every engraving bit was refused. Now only a missing angle is,
    // and the simulator's own cuttingSurfaceDz draws the rest.
    if (!isValidCncTipAngleDeg(tool.tipAngleDeg)) {
      return 'A valid 1–179° included angle is required; no engraving cone was modeled.';
    }
    if (
      tool.tipDiameterMm !== undefined &&
      !isValidCncTipDiameterMm(tool.tipDiameterMm, tool.diameterMm)
    ) {
      return `The engraving tip flat must be from 0 to under ${tool.diameterMm} mm; no engraving cone was modeled.`;
    }
    return null;
  }
  return tool.kind === 'v-bit' && !isValidCncTipAngleDeg(tool.tipAngleDeg)
    ? 'A valid 1–179° included angle is required; no V-bit cone was modeled.'
    : null;
}

export function bitPreviewShankDiameterMm(tool: CncTool): number | null {
  const diameterMm = tool.shankDiameterMm;
  return diameterMm !== undefined && Number.isFinite(diameterMm) && diameterMm > 0
    ? diameterMm
    : null;
}
