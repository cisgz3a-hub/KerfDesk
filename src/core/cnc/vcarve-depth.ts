import type { CncTool } from '../scene';
import { conicalRadialEnvelope, radialEnvelopeMaxDepthMm } from './radial-envelope';
import { vcarvePlanningAngleDeg } from './vcarve-angle';

// One depth law for every executable stage of a V-carve. A cutter without a
// modelled conical flank, or a V-bit with invalid angle geometry, cannot
// resolve a depth (ADR-576).
export function vcarveEffectiveDepthMm(tool: CncTool, requestedDepthMm: number): number | null {
  const includedAngleDeg = vcarvePlanningAngleDeg(tool);
  if (includedAngleDeg === null) return null;
  const envelope = conicalRadialEnvelope(tool, includedAngleDeg);
  if (envelope === null) return null;
  return Math.min(requestedDepthMm, radialEnvelopeMaxDepthMm(envelope));
}
