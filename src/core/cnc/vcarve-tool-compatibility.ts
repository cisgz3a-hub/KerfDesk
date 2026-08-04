import { isValidCncTipAngleDeg } from '../cnc-tip-angle';
import { isValidCncTipDiameterMm } from '../cnc-tip-diameter';
import type { CncTool } from '../scene';

/** True when a cutter family carries every engraving field this V-carve model needs. */
export function isVCarveToolCompatible(tool: CncTool): boolean {
  if (tool.kind === 'v-bit') return true;
  if (tool.kind !== 'engraving' || !isValidCncTipAngleDeg(tool.tipAngleDeg)) return false;
  return (
    tool.tipDiameterMm === undefined || isValidCncTipDiameterMm(tool.tipDiameterMm, tool.diameterMm)
  );
}
