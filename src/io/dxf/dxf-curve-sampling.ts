// Bulge / ellipse sampling for the DXF importer (Phase H.6). All samplers
// work in millimeters (entity converters scale drawing units to mm BEFORE
// sampling) so one chordal tolerance governs curve fidelity everywhere,
// independent of the file's $INSUNITS. The raw circular-arc sampler lives
// in core/geometry/arc-sampling (shared with the G-code program parser).

import { arcStepRad, sampleArcPoints } from '../../core/geometry/arc-sampling';
import type { Vec2 } from '../../core/scene';

const FULL_TURN = Math.PI * 2;

export const sampleArc = sampleArcPoints;

export function sampleCircle(center: Vec2, radiusMm: number): Vec2[] {
  const points = sampleArc(center, radiusMm, 0, FULL_TURN);
  // Drop the duplicated seam point; the polyline's `closed` flag joins it.
  points.pop();
  return points;
}

// Expand one LWPOLYLINE/VERTEX bulge segment. bulge = tan(sweep/4); positive
// bulges arc counter-clockwise from p1 to p2. Returns the intermediate +
// end points (p1 excluded so segments chain without duplicates).
export function bulgeSegment(p1: Vec2, p2: Vec2, bulge: number): Vec2[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0 || bulge === 0) return [p2];
  const sweep = 4 * Math.atan(bulge);
  const radius = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  // Signed distance from chord midpoint to arc center along the left normal.
  const centerOffset = chord / (2 * Math.tan(sweep / 2));
  const center: Vec2 = {
    x: (p1.x + p2.x) / 2 + (-dy / chord) * centerOffset,
    y: (p1.y + p2.y) / 2 + (dx / chord) * centerOffset,
  };
  const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
  const points = sampleArc(center, radius, startAngle, sweep);
  points.shift();
  // Snap the analytic endpoint exactly onto p2 so chained segments seal.
  points[points.length - 1] = p2;
  return points;
}

// Sample an ELLIPSE from startParam to endParam (radians; the DXF parameter
// t maps to point = center + major·cos t + minor·sin t, where minor is the
// major axis rotated +90° and scaled by ratio).
export function sampleEllipse(
  center: Vec2,
  majorAxis: Vec2,
  ratio: number,
  startParam: number,
  endParam: number,
): Vec2[] {
  const majorLen = Math.hypot(majorAxis.x, majorAxis.y);
  const sweep = normalizedSweep(startParam, endParam);
  const segments = Math.max(1, Math.ceil(sweep / arcStepRad(majorLen)));
  const minor: Vec2 = { x: -majorAxis.y * ratio, y: majorAxis.x * ratio };
  const points: Vec2[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = startParam + (sweep * i) / segments;
    points.push({
      x: center.x + majorAxis.x * Math.cos(t) + minor.x * Math.sin(t),
      y: center.y + majorAxis.y * Math.cos(t) + minor.y * Math.sin(t),
    });
  }
  return points;
}

export function isFullEllipseSweep(startParam: number, endParam: number): boolean {
  return normalizedSweep(startParam, endParam) >= FULL_TURN - 1e-9;
}

function normalizedSweep(startParam: number, endParam: number): number {
  let sweep = endParam - startParam;
  while (sweep <= 0) sweep += FULL_TURN;
  return Math.min(sweep, FULL_TURN);
}
