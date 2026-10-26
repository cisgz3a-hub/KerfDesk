// Where a G2/G3 arc's centre is, from I/J or R, for the render model
// (ADR-255 stage 2). Split out of gcode-render-model-builder.ts unchanged,
// except that it returns why a line is skipped instead of recording it.
// The points and words are in the arc's plane (render-model-arc.ts): I and J
// hold the offsets along the plane's first and second axes.

import { ijArcCenter, rArcGeometry } from '../gcode';

type XY = { readonly x: number; readonly y: number };

// Generic imports retain the legacy display tolerance. Stock GRBL uses
// radius-relative I/J validation and a strict R-form chord check instead.
export const ARC_RADIUS_TOLERANCE_MM = 0.127;

/** The arc's centre, or why the controller would reject the line. */
export function renderArcCenter(
  axisWords: ReadonlyMap<string, number>,
  from: XY,
  to: XY,
  clockwise: boolean,
  unitScale: number,
  stockGrbl = false,
  offsetNames = 'I/J',
): { readonly center: XY } | { readonly skipped: string } {
  const i = axisWords.get('I');
  const j = axisWords.get('J');
  const hasOffsets = i !== undefined || j !== undefined;
  if (stockGrbl && axisWords.has('R') && hasOffsets) {
    return { skipped: `R-form arc also supplies unused ${offsetNames} offsets` };
  }
  if (hasOffsets) return { center: ijArcCenter(from, i, j, unitScale) };
  const r = axisWords.get('R');
  if (r === undefined) return { skipped: `arc needs ${offsetNames} or R` };
  const solved = rArcGeometry(from, to, r, clockwise, unitScale);
  if (solved === null) return { skipped: 'R-form arc cannot start and end at the same point' };
  if (solved.halfChordGapSq < (stockGrbl ? 0 : -ARC_RADIUS_TOLERANCE_MM * solved.chordMm)) {
    return { skipped: 'arc radius too small for its chord' };
  }
  return { center: solved.center };
}

/** GRBL gcode.c:736-738: <=5um always; otherwise <=0.5mm and <=0.1%. */
export function arcRadiusMismatch(radius: number, endRadius: number, stockGrbl: boolean): boolean {
  const difference = Math.abs(radius - endRadius);
  return stockGrbl
    ? difference > 0.005 && (difference > 0.5 || difference > radius * 0.001)
    : difference > ARC_RADIUS_TOLERANCE_MM;
}
