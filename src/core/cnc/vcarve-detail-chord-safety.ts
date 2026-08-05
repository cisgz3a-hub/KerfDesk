import type { Vec2 } from '../scene';
import type { BoundarySegment } from './vcarve-detail-geometry';
import {
  everyIndexedVCarveBoundarySegmentInBox,
  type VCarveBoundaryIndex,
  type VCarveBoundaryQueryBox,
} from './vcarve-boundary-index';
import { radialEnvelopeSweepRadiiMm, type RadialEnvelope } from './radial-envelope';

const QUADRATIC_EPSILON_MM2 = 1e-14;

export function emittedChordIsSafe(
  a: Vec2,
  b: Vec2,
  depthA: number,
  depthB: number,
  segments: ReadonlyArray<BoundarySegment>,
  envelope: RadialEnvelope,
  boundaryIndex?: VCarveBoundaryIndex,
): boolean {
  const [radiusA, radiusB] = radialEnvelopeSweepRadiiMm(envelope, depthA, depthB);
  // The envelope radius varies linearly from radiusA to radiusB, so the swept
  // region cannot extend past the chord's bounding box grown by the larger of
  // the two. A segment outside that box is unreachable and therefore always
  // clears, which makes this rejection exact rather than approximate.
  //
  // It matters because this is the compaction inner loop: profile compaction
  // tests up to MAX_COMPACTION_SPAN_POINTS candidate spans per point, and each
  // one previously ran the quadratic clearance solve against every boundary
  // segment in the region. A single carved letter spent seconds here.
  const reach = Math.max(radiusA, radiusB);
  const box = {
    minX: Math.min(a.x, b.x) - reach,
    maxX: Math.max(a.x, b.x) + reach,
    minY: Math.min(a.y, b.y) - reach,
    maxY: Math.max(a.y, b.y) + reach,
  };
  if (boundaryIndex !== undefined) {
    return everyIndexedVCarveBoundarySegmentInBox(boundaryIndex, box, (segment) =>
      radiusChordClearsSegment(a, b, radiusA, radiusB, segment),
    );
  }
  return bruteForceChordClearance(a, b, radiusA, radiusB, segments, box);
}

function bruteForceChordClearance(
  a: Vec2,
  b: Vec2,
  radiusA: number,
  radiusB: number,
  segments: ReadonlyArray<BoundarySegment>,
  box: VCarveBoundaryQueryBox,
): boolean {
  for (const segment of segments) {
    if (Math.min(segment.ax, segment.bx) > box.maxX) continue;
    if (Math.max(segment.ax, segment.bx) < box.minX) continue;
    if (Math.min(segment.ay, segment.by) > box.maxY) continue;
    if (Math.max(segment.ay, segment.by) < box.minY) continue;
    if (!radiusChordClearsSegment(a, b, radiusA, radiusB, segment)) return false;
  }
  return true;
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
