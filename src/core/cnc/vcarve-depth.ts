import type { CncTool } from '../scene';
import { conicalRadialEnvelope, radialEnvelopeMaxDepthMm } from './radial-envelope';
import { vcarveIncludedAngleDeg } from './vcarve-angle';

// One depth law for every executable stage of a V-carve. An actual V-bit with
// invalid angle geometry cannot resolve a depth; legacy wrong-kind selections
// keep vcarveIncludedAngleDeg's established advisory-only fallback.
export function vcarveEffectiveDepthMm(tool: CncTool, requestedDepthMm: number): number | null {
  const includedAngleDeg = vcarveIncludedAngleDeg(tool);
  if (includedAngleDeg === null) return null;
  const envelope = conicalRadialEnvelope(tool, includedAngleDeg);
  if (envelope === null) return null;
  return Math.min(requestedDepthMm, radialEnvelopeMaxDepthMm(envelope));
}
