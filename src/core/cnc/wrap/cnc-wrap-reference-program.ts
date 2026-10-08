import type {
  CncWrapReferencePlan,
  CncWrapReferencePath,
  CncWrapPoint,
} from './cnc-wrap-reference-plan';
import { cncWrapSegmentLength } from './cnc-wrap-reference-plan';
const decimal = (value: number): string => Number(value.toFixed(6)).toString();
function coordinates(point: CncWrapPoint, axis: 'X' | 'Y'): string {
  return (
    axis + decimal(point.axialMm) + ' A' + decimal(point.angleDeg) + ' Z' + decimal(point.radialZMm)
  );
}
/** Study bytes only. No ordinary emitter, Save G-code, Frame or Start routes through this post. */
export function cncWrapReferenceProgram(plan: CncWrapReferencePlan): string {
  const lines = [
    '; OFFLINE CNC WRAP REFERENCE - UNQUALIFIED FOR MACHINE OUTPUT',
    '; G54: rotary A in degrees; radial Z0 at cylinder surface; linear ' + plan.linearAxis,
    'G21',
    'G90',
    'G54',
    'G94',
    'G0 Z' + decimal(plan.setup.radialClearanceMm),
  ];
  let tool: string | null = null;
  for (const path of plan.paths) {
    const first = path.points[0];
    if (first === undefined) continue;
    lines.push('G94', 'G0 Z' + decimal(plan.setup.radialClearanceMm));
    if (tool !== path.toolId) {
      lines.push('M5', '; Tool ' + cleanComment(path.toolName), 'M0');
      tool = path.toolId;
    }
    lines.push(
      'M3 S' + decimal(path.spindleRpm),
      'G4 P' + decimal(path.spindleSpinupSec),
      'G0 ' + plan.linearAxis + decimal(first.axialMm) + ' A' + decimal(first.angleDeg),
      'G1 Z' + decimal(first.radialZMm) + ' F' + decimal(path.plungeMmPerMin),
      'G93',
    );
    appendCutMoves(lines, path, plan);
  }
  lines.push('G94', 'G0 Z' + decimal(plan.setup.radialClearanceMm), 'M5', 'M2');
  return lines.join('\n') + '\n';
}
function appendCutMoves(
  lines: string[],
  path: CncWrapReferencePath,
  plan: CncWrapReferencePlan,
): void {
  for (let i = 1; i < path.points.length; i += 1) {
    const a = path.points[i - 1],
      b = path.points[i];
    if (a === undefined || b === undefined) throw new Error('Incomplete wrap reference path.');
    const length = cncWrapSegmentLength(a, b, plan.setup.radiusMm);
    if (length <= 1e-9) continue;
    const descent = Math.max(0, a.radialZMm - b.radialZMm);
    const minutes = Math.max(length / path.feedMmPerMin, descent / path.plungeMmPerMin);
    const inverse = 1 / minutes;
    if (!Number.isFinite(inverse) || inverse < 0.000001 || inverse > 1_000_000)
      throw new Error('A wrap reference feed cannot be represented at the supported precision.');
    lines.push('G1 ' + coordinates(b, plan.linearAxis) + ' F' + decimal(inverse));
  }
}
function cleanComment(text: string): string {
  return text.replace(/[\r\n;]/g, ' ').slice(0, 120);
}
