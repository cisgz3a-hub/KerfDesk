// Chord-tolerance arc sampling shared by the DXF importer and the G-code
// program parser (extracted when the .nc parser became the second consumer).
// Works in millimeters: one tolerance governs curve fidelity everywhere.

import type { Vec2 } from '../scene';

// Max chord deviation from the true curve — fine enough that a 0.1 mm kerf
// dominates the error.
export const ARC_CHORD_TOLERANCE_MM = 0.05;
const MIN_STEP_RAD = Math.PI / 180; // never finer than 1°/segment
const MAX_STEP_RAD = Math.PI / 12; // never coarser than 15°/segment

export function arcStepRad(radiusMm: number): number {
  if (!(radiusMm > 0)) return MAX_STEP_RAD;
  const ratio = 1 - ARC_CHORD_TOLERANCE_MM / radiusMm;
  if (ratio <= 0) return MAX_STEP_RAD;
  const step = 2 * Math.acos(ratio);
  return Math.min(MAX_STEP_RAD, Math.max(MIN_STEP_RAD, step));
}

// Sample a circular arc from startRad sweeping by sweepRad (signed; positive
// = counter-clockwise). Includes both endpoints.
export function sampleArcPoints(
  center: Vec2,
  radiusMm: number,
  startRad: number,
  sweepRad: number,
): Vec2[] {
  const segments = Math.max(1, Math.ceil(Math.abs(sweepRad) / arcStepRad(radiusMm)));
  const points: Vec2[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = startRad + (sweepRad * i) / segments;
    points.push({
      x: center.x + radiusMm * Math.cos(angle),
      y: center.y + radiusMm * Math.sin(angle),
    });
  }
  return points;
}
