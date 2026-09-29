// Where a G2/G3 arc's centre is, from I/J or R, for the render model
// (ADR-255 stage 2). Split out of gcode-render-model-builder.ts unchanged,
// except that it returns why a line is skipped instead of recording it.

import { ijArcCenter, rArcGeometry } from '../gcode';

type XY = { readonly x: number; readonly y: number };

// GRBL validates R-form/IJ arcs to ~0.005 in (mirrors the F-CNC10 parser).
export const ARC_RADIUS_TOLERANCE_MM = 0.127;

/** The arc's centre, or why the controller would reject the line. */
export function renderArcCenter(
  axisWords: ReadonlyMap<string, number>,
  from: XY,
  to: XY,
  clockwise: boolean,
  unitScale: number,
): { readonly center: XY } | { readonly skipped: string } {
  const i = axisWords.get('I');
  const j = axisWords.get('J');
  if (i !== undefined || j !== undefined) return { center: ijArcCenter(from, i, j, unitScale) };
  const r = axisWords.get('R');
  if (r === undefined) return { skipped: 'arc needs I/J or R' };
  const solved = rArcGeometry(from, to, r, clockwise, unitScale);
  if (solved === null) return { skipped: 'R-form arc cannot start and end at the same point' };
  if (solved.halfChordGapSq < -ARC_RADIUS_TOLERANCE_MM * solved.chordMm) {
    return { skipped: 'arc radius too small for its chord' };
  }
  return { center: solved.center };
}
