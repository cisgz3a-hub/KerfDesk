import { isValidCncTipAngleDeg } from '../cnc-tip-angle';
import type { CncTool } from '../scene';

// Wrong-kind V-carve selections have historically remained advisory-only and
// used this fallback. Actual V-bits must carry valid geometry instead.
const LEGACY_NON_VBIT_ANGLE_DEG = 60;

export function vcarveIncludedAngleDeg(tool: CncTool): number | null {
  const angleDeg = tool.tipAngleDeg;
  if (tool.kind === 'v-bit') return isValidCncTipAngleDeg(angleDeg) ? angleDeg : null;
  if (tool.kind === 'engraving') {
    return isValidCncTipAngleDeg(angleDeg) ? angleDeg : LEGACY_NON_VBIT_ANGLE_DEG;
  }
  // A tapered ball nose's taper is not a V-carve point cone: planned as one,
  // its few-degree flank would drive Z many times deeper than the artwork's
  // width allows while its ball cut wider than the cone. It keeps the
  // wrong-kind fallback instead, and preflight's V-carve compatibility warning
  // names it like any other non-V cutter (ADR-368).
  if (tool.kind === 'tapered-ball-nose') return LEGACY_NON_VBIT_ANGLE_DEG;
  return angleDeg !== undefined && Number.isFinite(angleDeg) && angleDeg >= 1
    ? angleDeg
    : LEGACY_NON_VBIT_ANGLE_DEG;
}
