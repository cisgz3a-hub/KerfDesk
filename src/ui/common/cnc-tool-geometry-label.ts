import { isValidCncTipAngleDeg } from '../../core/cnc-tip-angle';
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
  if (!isValidCncTipAngleDeg(angle)) {
    return `${tool.diameterMm} mm, included angle missing, ${kind}`;
  }
  return `${tool.diameterMm} mm, ${angle}° ${kind}`;
}
