import { isValidCncTipAngleDeg } from '../../core/cnc-tip-angle';
import { isValidCncTipDiameterMm } from '../../core/cnc-tip-diameter';
import { isValidTaperedBallTipDiameterMm } from '../../core/cnc-tapered-ball';
import type { CncTool, CncToolKind } from '../../core/scene';

const TOOL_KIND_LABELS: Readonly<Record<CncToolKind, string>> = {
  'end-mill': 'End mill',
  'ball-nose': 'Ball nose',
  'v-bit': 'V-bit',
  engraving: 'Engraving bit',
  'tapered-ball-nose': 'Tapered ball nose',
};

export function cncToolGeometryLabel(tool: CncTool): string {
  const kind = TOOL_KIND_LABELS[tool.kind];
  if (tool.kind === 'tapered-ball-nose') return taperedBallLabel(tool, kind);
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

// Sellers list a tapered ball nose by tip size and PER-SIDE taper, so the row
// shows those numbers; the stored included angle is twice the side angle.
function taperedBallLabel(tool: CncTool, kind: string): string {
  const tipDiameterMm = tool.tipDiameterMm;
  const tip = isValidTaperedBallTipDiameterMm(tipDiameterMm, tool.diameterMm)
    ? `${tipDiameterMm} mm tip`
    : tipDiameterMm === undefined
      ? 'tip diameter missing'
      : 'invalid tip diameter';
  const angle = tool.tipAngleDeg;
  const taper = isValidCncTipAngleDeg(angle) ? `${angle / 2}° per side` : 'taper angle missing';
  return `${tool.diameterMm} mm, ${tip}, ${taper}, ${kind}`;
}
