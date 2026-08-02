import type { Vec2 } from '../scene';
import type { BoundarySegment } from './vcarve-detail-geometry';

const QUADRATIC_EPSILON_MM2 = 1e-14;

export function emittedChordIsSafe(
  a: Vec2,
  b: Vec2,
  depthA: number,
  depthB: number,
  segments: ReadonlyArray<BoundarySegment>,
  tanHalf: number,
): boolean {
  const radiusA = depthA * tanHalf;
  const radiusB = depthB * tanHalf;
  return segments.every((segment) => radiusChordClearsSegment(a, b, radiusA, radiusB, segment));
}

function radiusChordClearsSegment(
  a: Vec2,
  b: Vec2,
  radiusA: number,
  radiusB: number,
  segment: BoundarySegment,
): boolean {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = segment.bx - segment.ax;
  const wy = segment.by - segment.ay;
  const wLengthSquared = wx * wx + wy * wy;
  if (wLengthSquared === 0) {
    return quadraticClearanceOnInterval(
      a.x - segment.ax,
      a.y - segment.ay,
      vx,
      vy,
      radiusA,
      radiusB - radiusA,
      0,
      1,
    );
  }
  const u0 = ((a.x - segment.ax) * wx + (a.y - segment.ay) * wy) / wLengthSquared;
  const uSlope = (vx * wx + vy * wy) / wLengthSquared;
  const breaks = projectionBreaks(u0, uSlope);
  for (let index = 0; index < breaks.length - 1; index += 1) {
    const low = breaks[index];
    const high = breaks[index + 1];
    if (low === undefined || high === undefined) continue;
    const coefficients = nearestVectorCoefficients(
      a,
      { x: vx, y: vy },
      segment,
      u0,
      uSlope,
      (low + high) / 2,
    );
    if (
      !quadraticClearanceOnInterval(
        coefficients.x0,
        coefficients.y0,
        coefficients.x1,
        coefficients.y1,
        radiusA,
        radiusB - radiusA,
        low,
        high,
      )
    ) {
      return false;
    }
  }
  return true;
}

function projectionBreaks(u0: number, uSlope: number): ReadonlyArray<number> {
  const values = [0, 1];
  if (uSlope !== 0) {
    for (const boundary of [0, 1]) {
      const t = (boundary - u0) / uSlope;
      if (t > 0 && t < 1) values.push(t);
    }
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

function nearestVectorCoefficients(
  a: Vec2,
  velocity: Vec2,
  segment: BoundarySegment,
  u0: number,
  uSlope: number,
  sampleT: number,
): { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } {
  const sampleU = u0 + uSlope * sampleT;
  if (sampleU <= 0) {
    return {
      x0: a.x - segment.ax,
      y0: a.y - segment.ay,
      x1: velocity.x,
      y1: velocity.y,
    };
  }
  if (sampleU >= 1) {
    return {
      x0: a.x - segment.bx,
      y0: a.y - segment.by,
      x1: velocity.x,
      y1: velocity.y,
    };
  }
  const wx = segment.bx - segment.ax;
  const wy = segment.by - segment.ay;
  return {
    x0: a.x - segment.ax - wx * u0,
    y0: a.y - segment.ay - wy * u0,
    x1: velocity.x - wx * uSlope,
    y1: velocity.y - wy * uSlope,
  };
}

function quadraticClearanceOnInterval(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius0: number,
  radiusSlope: number,
  low: number,
  high: number,
): boolean {
  const a = x1 * x1 + y1 * y1 - radiusSlope * radiusSlope;
  const b = 2 * (x0 * x1 + y0 * y1 - radius0 * radiusSlope);
  const c = x0 * x0 + y0 * y0 - radius0 * radius0;
  let minimum = Math.min(quadraticAt(a, b, c, low), quadraticAt(a, b, c, high));
  if (a > 0) {
    const vertex = -b / (2 * a);
    if (vertex > low && vertex < high) minimum = Math.min(minimum, quadraticAt(a, b, c, vertex));
  }
  return minimum >= -QUADRATIC_EPSILON_MM2;
}

function quadraticAt(a: number, b: number, c: number, t: number): number {
  return (a * t + b) * t + c;
}
