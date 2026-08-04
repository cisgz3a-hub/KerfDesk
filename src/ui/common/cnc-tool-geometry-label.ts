import { isValidCncTipAngleDeg } from '../../core/cnc-tip-angle';
import { isValidCncTipDiameterMm } from '../../core/cnc-tip-diameter';
import type { CncTool, CncToolKind } from '../../core/scene';

const TOOL_KIND_LABELS: Readonly<Record<CncToolKind, string>> = {
  'end-mill': 'End mill',
  'ball-nose': 'Ball nose',
  'v-bit': 'V-bit',
  engraving: 'Engraving bit',
};

export function cncToolGeometryLabel(tool: CncTool): string {
  const kind = TOOL_KIND_LABELS[tool.kind];
  if (tool.kind !== 'v-bit' && tool.kind !== 'engraving') {
    return `${tool.diameterMm} mm, ${kind}`;
  }
  const angle = tool.tipAngleDeg;
  const geometry = !isValidCncTipAngleDeg(angle)
    ? `${tool.diameterMm} mm, included angle missing, ${kind}`
    : `${tool.diameterMm} mm, ${angle}° ${kind}`;
  return tool.kind === 'engraving' ? `${geometry}, ${engravingTipLabel(tool)}` : geometry;
}

function engravingTipLabel(tool: CncTool): string {
  const tipDiameterMm = tool.tipDiameterMm;
  if (tipDiameterMm === undefined || tipDiameterMm === 0) return 'pointed tip';
  return isValidCncTipDiameterMm(tipDiameterMm, tool.diameterMm)
    ? `${tipDiameterMm} mm tip flat`
    : 'invalid tip flat';
}
