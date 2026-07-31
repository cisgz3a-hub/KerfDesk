import { isValidCncTipAngleDeg, type CncTool } from '../scene';

// Wrong-kind V-carve selections have historically remained advisory-only and
// used this fallback. Actual V-bits must carry valid geometry instead.
const LEGACY_NON_VBIT_ANGLE_DEG = 60;

export function vcarveIncludedAngleDeg(tool: CncTool): number | null {
  const angleDeg = tool.tipAngleDeg;
  if (tool.kind === 'v-bit') return isValidCncTipAngleDeg(angleDeg) ? angleDeg : null;
  if (tool.kind === 'engraving') {
    return isValidCncTipAngleDeg(angleDeg) ? angleDeg : LEGACY_NON_VBIT_ANGLE_DEG;
  }
  return angleDeg !== undefined && Number.isFinite(angleDeg) && angleDeg >= 1
    ? angleDeg
    : LEGACY_NON_VBIT_ANGLE_DEG;
}
