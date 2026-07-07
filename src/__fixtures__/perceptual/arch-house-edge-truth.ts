import type { Polyline, Vec2 } from '../../core/scene';
import { polylineLength } from './benchmark-rating';
import { sampleByArcLength } from './centerline-geometry';

export type ArchContinuityQuality = {
  readonly archPolylineCount: number;
  readonly shortArchPolylineCount: number;
  readonly aggregateArchCoverageRatio: number;
  readonly longestArchCoverageRatio: number;
  readonly maxLongestArchGapDeg: number;
};

// Coverage must sample the drawn PATH, not the vertex list — simplified
// polylines describe long arcs with a handful of points, and the laser burns
// the segments between them.
const COVERAGE_SAMPLE_SPACING_PX = 1;

function densifiedPoints(polyline: Polyline): Vec2[] {
  const pts =
    polyline.closed && polyline.points.length > 1 && polyline.points[0] !== undefined
      ? [...polyline.points, polyline.points[0]]
      : [...polyline.points];
  return sampleByArcLength(pts, COVERAGE_SAMPLE_SPACING_PX);
}

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
      points: densifiedPoints(polyline).filter((point) => pointFallsInArchBand(point, arch)),
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

// --- letter-outline closure and smoothness (the 2026-07-03 defects) ---

// An open chain whose own two ends nearly touch is a letter outline that
// failed to close — the user sees a small gap breaking the word.
const NEARLY_CLOSED_MAX_GAP_PX = 8;
const NEARLY_CLOSED_MIN_LENGTH_PX = 30;

export type NearlyClosedQuality = {
  readonly nearlyClosedOpenCount: number;
  readonly maxNearlyClosedGapPx: number;
};

export function measureNearlyClosedOpenChains(
  polylines: ReadonlyArray<Polyline>,
): NearlyClosedQuality {
  let count = 0;
  let maxGap = 0;
  for (const polyline of polylines) {
    if (polyline.closed || polyline.points.length < 3) continue;
    const first = polyline.points[0];
    const last = polyline.points.at(-1);
    if (first === undefined || last === undefined) continue;
    const selfGap = Math.hypot(last.x - first.x, last.y - first.y);
    if (selfGap > NEARLY_CLOSED_MAX_GAP_PX) continue;
    if (polylineLength(polyline.points) < NEARLY_CLOSED_MIN_LENGTH_PX) continue;
    count += 1;
    maxGap = Math.max(maxGap, selfGap);
  }
  return { nearlyClosedOpenCount: count, maxNearlyClosedGapPx: maxGap };
}

export type BandRect = {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
};

/** The LANGEBAAN word band of the fixture — the small gold subtitle text. */
export const LANGEBAAN_BAND: BandRect = { x0: 300, y0: 660, x1: 735, y1: 725 };

// Wobble = EXCESS turning: within a short window of drawn path, the sum of
// absolute per-step turns minus the net direction change. A clean curve or
// a genuine corner turns ONE way (excess 0, however sharp); staircase lumps
// and S-squiggles turn back and forth, and only that cancellation counts.
// Small alternating sampling noise is ignored by the per-step floor.
const TURN_SAMPLE_STEP_PX = 1.5;
const EXCESS_TURN_WINDOW_SAMPLES = 4;
const EXCESS_TURN_FLOOR_RAD = (6 * Math.PI) / 180;

export function measureBandExcessTurnPer100Px(
  polylines: ReadonlyArray<Polyline>,
  band: BandRect,
): number {
  let excessRad = 0;
  let totalLengthPx = 0;
  for (const polyline of polylines) {
    if (polyline.points.length < 3 || !polylineInBand(polyline, band)) continue;
    const closedPts =
      polyline.closed && polyline.points[0] !== undefined
        ? [...polyline.points, polyline.points[0]]
        : [...polyline.points];
    const samples = sampleByArcLength(closedPts, TURN_SAMPLE_STEP_PX);
    excessRad += windowedExcessRad(flooredTurns(samples));
    totalLengthPx += polylineLength(closedPts);
  }
  if (totalLengthPx === 0) return 0;
  return ((excessRad * 180) / Math.PI / totalLengthPx) * 100;
}

function polylineInBand(polyline: Polyline, band: BandRect): boolean {
  return polyline.points.every(
    (p) => p.x >= band.x0 && p.x <= band.x1 && p.y >= band.y0 && p.y <= band.y1,
  );
}

function flooredTurns(samples: ReadonlyArray<Vec2>): number[] {
  const turns: number[] = [];
  for (let i = 1; i + 1 < samples.length; i += 1) {
    const prev = samples[i - 1];
    const at = samples[i];
    const next = samples[i + 1];
    if (prev === undefined || at === undefined || next === undefined) continue;
    const turn = turnAngle(prev, at, next);
    turns.push(Math.abs(turn) >= EXCESS_TURN_FLOOR_RAD ? turn : 0);
  }
  return turns;
}

function windowedExcessRad(turns: ReadonlyArray<number>): number {
  let excess = 0;
  const window = EXCESS_TURN_WINDOW_SAMPLES;
  for (let start = 0; start + window <= turns.length; start += window) {
    let sumAbs = 0;
    let sumSigned = 0;
    for (let k = start; k < start + window; k += 1) {
      const turn = turns[k] ?? 0;
      sumAbs += Math.abs(turn);
      sumSigned += turn;
    }
    excess += sumAbs - Math.abs(sumSigned);
  }
  return excess;
}

function turnAngle(prev: Vec2, at: Vec2, next: Vec2): number {
  const a1 = Math.atan2(at.y - prev.y, at.x - prev.x);
  const a2 = Math.atan2(next.y - at.y, next.x - at.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
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
