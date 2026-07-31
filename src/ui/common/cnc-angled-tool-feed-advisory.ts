import { isValidCncTipAngleDeg, type CncTool } from '../../core/scene';

// The generic material recipe is deliberately still available for angled bits
// (WORKFLOW F-CNC24). This copy makes its exact model boundary visible without
// changing, disabling, or gating the calculation.
export function cncAngledToolFeedAdvisory(tool: CncTool): string | null {
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
