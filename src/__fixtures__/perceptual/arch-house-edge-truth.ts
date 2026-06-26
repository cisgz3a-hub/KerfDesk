import type { Polyline, Vec2 } from '../../core/scene';

export type ArchContinuityQuality = {
  readonly archPolylineCount: number;
  readonly shortArchPolylineCount: number;
  readonly aggregateArchCoverageRatio: number;
  readonly longestArchCoverageRatio: number;
  readonly maxLongestArchGapDeg: number;
};

export function measureTopArchContinuity(
  polylines: ReadonlyArray<Polyline>,
): ArchContinuityQuality {
  const arch = {
    center: { x: 512, y: 407 },
    radius: 196,
    radialTolerance: 22,
    startDeg: 182,
    endDeg: 358,
    sectors: 44,
  };
  const archPolylines = polylines
    .map((polyline) => ({
      polyline,
      points: polyline.points.filter((point) => pointFallsInArchBand(point, arch)),
    }))
    .filter((entry) => entry.points.length >= 8);
  const shortArchPolylineCount = archPolylines.filter(
    (entry) => polylineLength(entry.points) < 24,
  ).length;
  const longest = archPolylines.reduce<ReadonlyArray<Vec2> | null>(
    (best, entry) => (best === null || entry.points.length > best.length ? entry.points : best),
    null,
  );
  const aggregateCovered = new Uint8Array(arch.sectors);
  for (const entry of archPolylines) markArchCoverage(aggregateCovered, entry.points, arch);
  const covered = new Uint8Array(arch.sectors);
  markArchCoverage(covered, longest ?? [], arch);

  return {
    archPolylineCount: archPolylines.length,
    shortArchPolylineCount,
    aggregateArchCoverageRatio: countCovered(aggregateCovered) / arch.sectors,
    longestArchCoverageRatio: countCovered(covered) / arch.sectors,
    maxLongestArchGapDeg: (maxZeroRun(covered) * (arch.endDeg - arch.startDeg)) / arch.sectors,
  };
}

function markArchCoverage(
  covered: Uint8Array,
  points: ReadonlyArray<Vec2>,
  arch: {
    readonly center: Vec2;
    readonly startDeg: number;
    readonly endDeg: number;
    readonly sectors: number;
  },
): void {
  for (const point of points) {
    const angle = normalizedAngleDeg(point, arch.center);
    const t = (angle - arch.startDeg) / (arch.endDeg - arch.startDeg);
    if (t < 0 || t > 1) continue;
    covered[Math.min(arch.sectors - 1, Math.floor(t * arch.sectors))] = 1;
  }
}

function pointFallsInArchBand(
  point: Vec2,
  arch: {
    readonly center: Vec2;
    readonly radius: number;
    readonly radialTolerance: number;
    readonly startDeg: number;
    readonly endDeg: number;
  },
): boolean {
  const radius = Math.hypot(point.x - arch.center.x, point.y - arch.center.y);
  if (Math.abs(radius - arch.radius) > arch.radialTolerance) return false;
  const angle = normalizedAngleDeg(point, arch.center);
  return angle >= arch.startDeg && angle <= arch.endDeg;
}

function normalizedAngleDeg(point: Vec2, center: Vec2): number {
  return ((Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 360) % 360;
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

function maxZeroRun(values: Uint8Array): number {
  let best = 0;
  let run = 0;
  for (const value of values) {
    if (value === 0) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}
