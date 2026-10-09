import { isValidCncTipAngleDeg } from '../cnc-tip-angle';
import type { CncTool } from '../scene';
import { isVCarveToolCompatible } from './vcarve-tool-compatibility';

// Simulation and surface-contact kernels still draw wrong-kind cutters with
// this fallback cone. V-carve planning does not (vcarvePlanningAngleDeg).
const LEGACY_NON_VBIT_ANGLE_DEG = 60;

export function vcarveIncludedAngleDeg(tool: CncTool): number | null {
  const angleDeg = tool.tipAngleDeg;
  if (tool.kind === 'v-bit') return isValidCncTipAngleDeg(angleDeg) ? angleDeg : null;
  if (tool.kind === 'engraving') {
    return isValidCncTipAngleDeg(angleDeg) ? angleDeg : LEGACY_NON_VBIT_ANGLE_DEG;
  }
  // A tapered ball nose's taper is not a V-carve point cone: planned as one,
  // its few-degree flank would drive Z many times deeper than the artwork's
  // width allows while its ball cut wider than the cone (ADR-368).
  if (tool.kind === 'tapered-ball-nose') return LEGACY_NON_VBIT_ANGLE_DEG;
  return angleDeg !== undefined && Number.isFinite(angleDeg) && angleDeg >= 1
    ? angleDeg
    : LEGACY_NON_VBIT_ANGLE_DEG;
}

/** The included angle every executable V-carve stage plans with. Only a V-bit or
 * a fully modelled angled engraving bit has the conical flank the depth law
 * needs; any other cutter plans no V-carve motion (ADR-576). */
export function vcarvePlanningAngleDeg(tool: CncTool): number | null {
  return isVCarveToolCompatible(tool) ? vcarveIncludedAngleDeg(tool) : null;
}
