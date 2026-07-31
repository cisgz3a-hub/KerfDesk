// A catalog preview uses the simulator profile verbatim. The profile's
// vertical stub is only a display aid at cutter radius: without cutting length
// or transition-height metadata, stepping it to a catalog shank diameter could
// falsely enlarge or neck the cutting tip. The UI reports shank diameter as
// metadata instead of inventing that transition.

import { isValidCncTipAngleDeg } from '../../core/cnc-tip-angle';
import type { CncTool } from '../../core/scene';
import { toolProfile, type ToolProfilePoint } from '../../core/sim';

export function bitPreviewProfile(tool: CncTool): ReadonlyArray<ToolProfilePoint> {
  const issue = bitPreviewGeometryIssue(tool);
  if (issue !== null) throw new Error(issue);
  return toolProfile(tool);
}

export function bitPreviewGeometryIssue(tool: CncTool): string | null {
  if (tool.kind === 'engraving') {
    return 'Legacy engraving tools do not store enough tip geometry for a truthful 3D cutting envelope; no engraving shape was modeled.';
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
