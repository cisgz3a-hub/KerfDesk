import type { CncTool } from '../scene';
import { vcarveIncludedAngleDeg } from './vcarve-angle';

// One depth law for every executable stage of a V-carve. An actual V-bit with
// invalid angle geometry cannot resolve a depth; legacy wrong-kind selections
// keep vcarveIncludedAngleDeg's established advisory-only fallback.
export function vcarveEffectiveDepthMm(tool: CncTool, requestedDepthMm: number): number | null {
  const includedAngleDeg = vcarveIncludedAngleDeg(tool);
  if (includedAngleDeg === null) return null;
  const tanHalf = Math.tan((includedAngleDeg * Math.PI) / 360);
  const coneHeightMm =
    Number.isFinite(tool.diameterMm) && tool.diameterMm > 0
      ? tool.diameterMm / 2 / tanHalf
      : Number.POSITIVE_INFINITY;
  return Math.min(requestedDepthMm, coneHeightMm);
}
