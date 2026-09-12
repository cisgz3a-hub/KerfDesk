import type { Polyline, Vec2 } from '../scene';
import {
  buildVCarveBoundarySegmentIndex,
  everyVCarveBoundarySegmentInBox,
} from './vcarve-boundary-segment-index';
import type { BoundarySegment } from './vcarve-detail-geometry';

type Interval = { readonly start: number; readonly end: number };

/**
 * Every point on the source boundary must lie in the target boundary's
 * distance envelope. Intersect each source segment with the union of target
 * segment capsules, then require coverage of its whole [0,1] parameter span.
 * Bounding boxes and vertex samples alone cannot establish this property.
 */
export function contourBoundaryWithinDistance(
  source: Polyline,
  target: Polyline,
  radius: number,
): boolean {
  if (!(radius > 0) || !Number.isFinite(radius)) return false;
  const segments = target.points.map((a, index): BoundarySegment => {
    const b = target.points[(index + 1) % target.points.length] as Vec2;
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
  });
  const index = buildVCarveBoundarySegmentIndex(segments);
  return source.points.every((a, at) => {
    const b = source.points[(at + 1) % source.points.length] as Vec2;
    const intervals: Interval[] = [];
    everyVCarveBoundarySegmentInBox(
      index,
      {
        minX: Math.min(a.x, b.x) - radius,
        minY: Math.min(a.y, b.y) - radius,
        maxX: Math.max(a.x, b.x) + radius,
        maxY: Math.max(a.y, b.y) + radius,
      },
      (segment) => {
        const interval = capsuleInterval(a, b, segment, radius);
        if (interval !== null) intervals.push(interval);
        return true;
      },
    );
    intervals.sort((left, right) => left.start - right.start);
    let covered = 0;
    for (const interval of intervals) {
      if (interval.start > covered) return false;
      covered = Math.max(covered, interval.end);
      if (covered >= 1) return true;
    }
    return false;
  });
}

// A capsule is its finite rectangular strip plus its two endpoint discs.
// It is convex, so its intersection with one line is one interval.
function capsuleInterval(
  a: Vec2,
  b: Vec2,
  segment: BoundarySegment,
  radius: number,
): Interval | null {
  const start = circleInterval(a, b, { x: segment.ax, y: segment.ay }, radius);
  const end = circleInterval(a, b, { x: segment.bx, y: segment.by }, radius);
  const dx = segment.bx - segment.ax;
  const dy = segment.by - segment.ay;
  const length = Math.hypot(dx, dy);
  let strip: Interval | null = null;
  if (length > 0) {
    const ux = dx / length;
    const uy = dy / length;
    const wx = a.x - segment.ax;
    const wy = a.y - segment.ay;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    strip = intersect(
      linearInterval(wx * ux + wy * uy, vx * ux + vy * uy, 0, length),
      linearInterval(wx * uy - wy * ux, vx * uy - vy * ux, -radius, radius),
    );
  }
  const intervals = [start, end, strip].filter((value): value is Interval => value !== null);
  if (intervals.length === 0) return null;
  return {
    start: Math.min(...intervals.map((value) => value.start)),
    end: Math.max(...intervals.map((value) => value.end)),
  };
}

function circleInterval(a: Vec2, b: Vec2, center: Vec2, radius: number): Interval | null {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = a.x - center.x;
  const wy = a.y - center.y;
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared === 0) {
    return Math.hypot(wx, wy) <= radius ? { start: 0, end: 1 } : null;
  }
  const cross = wx * vy - wy * vx;
  const perpendicularSquared = (cross * cross) / lengthSquared;
  if (perpendicularSquared > radius * radius) return null;
  const middle = -(wx * vx + wy * vy) / lengthSquared;
  const half = Math.sqrt((radius * radius - perpendicularSquared) / lengthSquared);
  return boundedInterval(middle - half, middle + half);
}

function linearInterval(offset: number, slope: number, min: number, max: number): Interval | null {
  if (slope === 0) return offset >= min && offset <= max ? { start: 0, end: 1 } : null;
  const a = (min - offset) / slope;
  const b = (max - offset) / slope;
  return boundedInterval(Math.min(a, b), Math.max(a, b));
}

function boundedInterval(start: number, end: number): Interval | null {
  const from = Math.max(0, start);
  const to = Math.min(1, end);
  return from <= to ? { start: from, end: to } : null;
}

function intersect(a: Interval | null, b: Interval | null): Interval | null {
  if (a === null || b === null) return null;
  return boundedInterval(Math.max(a.start, b.start), Math.min(a.end, b.end));
}
