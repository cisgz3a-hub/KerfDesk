import type { Polyline, Vec2 } from '../../core/scene';
import type { RawImageData } from '../../core/trace';

export type CircleFixture = {
  readonly image: RawImageData;
  readonly center: Vec2;
  readonly radius: number;
};

export type SegmentedStrokeQuality = {
  readonly strokePolylineCount: number;
  readonly longestStrokeAngularCoverageRatio: number;
  readonly maxLongestStrokeAngularGapDeg: number;
};

export const SEGMENTED_STROKE_CIRCLE_FIXTURE = segmentedStrokeCircleFixture(
  128,
  { x: 64, y: 64 },
  35,
  5,
);

export function measureSegmentedStrokeContinuity(
  polylines: ReadonlyArray<Polyline>,
  fixture: CircleFixture,
): SegmentedStrokeQuality {
  const strokePolylines = polylines.filter((polyline) =>
    polyline.points.some((point) => {
      const radius = Math.hypot(point.x - fixture.center.x, point.y - fixture.center.y);
      return Math.abs(radius - fixture.radius) <= 6;
    }),
  );
  const longest = strokePolylines.reduce<Polyline | null>(
    (best, polyline) =>
      best === null || polylineLength(polyline.points) > polylineLength(best.points)
        ? polyline
        : best,
    null,
  );
  const sectors = 72;
  const covered = new Uint8Array(sectors);
  for (const point of longest?.points ?? []) {
    const dx = point.x - fixture.center.x;
    const dy = point.y - fixture.center.y;
    const radius = Math.hypot(dx, dy);
    if (Math.abs(radius - fixture.radius) > 6) continue;
    const angle = Math.atan2(dy, dx);
    const normalized = angle < 0 ? angle + Math.PI * 2 : angle;
    covered[Math.min(sectors - 1, Math.floor((normalized / (Math.PI * 2)) * sectors))] = 1;
  }

  return {
    strokePolylineCount: strokePolylines.length,
    longestStrokeAngularCoverageRatio: countCovered(covered) / sectors,
    maxLongestStrokeAngularGapDeg: (maxZeroRunCyclic(covered) * 360) / sectors,
  };
}

function segmentedStrokeCircleFixture(
  size: number,
  center: Vec2,
  radius: number,
  strokeWidth: number,
): CircleFixture {
  const data = new Uint8ClampedArray(size * size * 4);
  const gapCentersDeg = [18, 76, 134, 192, 250, 308];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const dx = x + 0.5 - center.x;
      const dy = y + 0.5 - center.y;
      const radial = Math.hypot(dx, dy);
      const angleDeg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const inSmallGap = gapCentersDeg.some(
        (gapCenter) => angularDistanceDeg(angleDeg, gapCenter) <= 2.2,
      );
      const value = Math.abs(radial - radius) <= strokeWidth / 2 && !inSmallGap ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { image: { width: size, height: size, data }, center, radius };
}

function polylineLength(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a !== undefined && b !== undefined) total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
}

function countCovered(values: Uint8Array): number {
  let total = 0;
  for (const value of values) if (value === 1) total += 1;
  return total;
}

function maxZeroRunCyclic(values: Uint8Array): number {
  if (values.length === 0 || countCovered(values) === values.length) return 0;
  let best = 0;
  let run = 0;
  for (let i = 0; i < values.length * 2; i += 1) {
    if (values[i % values.length] === 0) {
      run += 1;
      best = Math.max(best, Math.min(run, values.length));
    } else {
      run = 0;
    }
  }
  return best;
}

function angularDistanceDeg(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}
