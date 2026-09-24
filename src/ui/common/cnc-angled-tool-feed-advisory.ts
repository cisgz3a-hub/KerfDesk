import { isValidCncTipAngleDeg } from '../../core/cnc-tip-angle';
import { isValidTaperedBallTipDiameterMm } from '../../core/cnc-tapered-ball';
import type { CncTool } from '../../core/scene';

// The generic material recipe is deliberately still available for angled bits
// (WORKFLOW F-CNC24). This copy makes its exact model boundary visible without
// changing, disabling, or gating the calculation.
export function cncAngledToolFeedAdvisory(tool: CncTool): string | null {
  if (tool.kind === 'tapered-ball-nose') return taperedBallFeedAdvisory(tool);
  if (tool.kind !== 'v-bit' && tool.kind !== 'engraving') return null;
  const kindLabel = tool.kind === 'v-bit' ? 'V-bit' : 'Engraving-bit';
  const angleLabel = isValidCncTipAngleDeg(tool.tipAngleDeg)
    ? `${tool.tipAngleDeg}° included angle`
    : 'missing or invalid included angle';
  return (
    `${kindLabel} rough guide: the material recipe uses the stored ${tool.diameterMm} mm ` +
    `diameter band. It does not model the ${angleLabel} or the cutting width at each depth. ` +
    `Start with the cutter manufacturer's data, then verify feed, plunge, RPM, ` +
    'and depth/pass for this exact bit on scrap.'
  );
}

// A tapered ball nose mostly cuts with its small tip, while the recipe reads the
// widest stored diameter, so the gap is larger than for a V-bit (ADR-368).
function taperedBallFeedAdvisory(tool: CncTool): string {
  const tipLabel = isValidTaperedBallTipDiameterMm(tool.tipDiameterMm, tool.diameterMm)
    ? `${tool.tipDiameterMm} mm ball tip`
    : 'missing or invalid ball tip';
  return (
    `Tapered ball-nose rough guide: the material recipe uses the stored ${tool.diameterMm} mm ` +
    `diameter band, not the ${tipLabel} that does most of the cutting, and it does not model ` +
    "the taper or the cutting width at each depth. Start with the cutter manufacturer's data, " +
    'then verify feed, plunge, RPM, and depth/pass for this exact bit on scrap.'
  );
}
