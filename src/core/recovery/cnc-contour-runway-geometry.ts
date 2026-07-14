import type { Vec2 } from '../scene';

const SECONDS_PER_MINUTE = 60;
const KINEMATIC_DIVISOR = 2;
const GEOMETRY_EPSILON_MM = 1e-9;
const DIRECTION_DOT_TOLERANCE = 1e-9;

export type CncRunwayParameters = {
  readonly minRunwayMm: number;
  readonly accelerationMmPerSec2: number;
  readonly safetyMarginMm: number;
};

export type CncRunwayProfile = CncRunwayParameters & {
  readonly qualificationId: string;
};

export function isValidRunwayParameters(parameters: CncRunwayParameters): boolean {
  return (
    Number.isFinite(parameters.minRunwayMm) &&
    parameters.minRunwayMm > 0 &&
    Number.isFinite(parameters.accelerationMmPerSec2) &&
    parameters.accelerationMmPerSec2 > 0 &&
    Number.isFinite(parameters.safetyMarginMm) &&
    parameters.safetyMarginMm >= 0
  );
}

export function isValidRunwayProfile(profile: CncRunwayProfile): boolean {
  return profile.qualificationId.trim().length > 0 && isValidRunwayParameters(profile);
}

export function requiredContourRunwayMm(
  profile: CncRunwayParameters,
  feedMmPerMin: number,
): number {
  const speedMmPerSec = feedMmPerMin / SECONDS_PER_MINUTE;
  const accelerationDistance =
    (speedMmPerSec * speedMmPerSec) / (KINEMATIC_DIVISOR * profile.accelerationMmPerSec2);
  return Math.max(profile.minRunwayMm, accelerationDistance + profile.safetyMarginMm);
}

export function clearedContourDistanceMm(
  points: ReadonlyArray<Vec2>,
  segmentIndex: number,
): number {
  let total = 0;
  for (let index = 0; index < segmentIndex; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (start !== undefined && end !== undefined) total += distance(start, end);
  }
  return total;
}

export function clearedTangentDistanceMm(
  points: ReadonlyArray<Vec2>,
  segmentIndex: number,
): number {
  const targetStart = points[segmentIndex];
  const targetEnd = points[segmentIndex + 1];
  if (targetStart === undefined || targetEnd === undefined) return 0;
  const target = direction(targetStart, targetEnd);
  if (target === null) return 0;
  let total = 0;
  for (let index = segmentIndex - 1; index >= 0; index -= 1) {
    const start = points[index];
    const end = points[index + 1];
    if (start === undefined || end === undefined) return 0;
    const candidate = direction(start, end);
    if (candidate === null) continue;
    if (!hasSameDirection(candidate, target)) break;
    total += distance(start, end);
  }
  return total;
}

export function isClearedDistanceSufficient(availableMm: number, requiredMm: number): boolean {
  return availableMm + GEOMETRY_EPSILON_MM >= requiredMm;
}

export function backtrackContourPolyline(
  points: ReadonlyArray<Vec2>,
  segmentIndex: number,
  distanceMm: number,
): ReadonlyArray<Vec2> | null {
  const anchor = points[segmentIndex];
  if (anchor === undefined) return null;
  const reversed: Vec2[] = [anchor];
  let remaining = distanceMm;
  for (let index = segmentIndex - 1; index >= 0; index -= 1) {
    const start = points[index];
    const end = points[index + 1];
    if (start === undefined || end === undefined) return null;
    const length = distance(start, end);
    if (length <= GEOMETRY_EPSILON_MM) continue;
    if (remaining <= length + GEOMETRY_EPSILON_MM) {
      const ratio = Math.min(1, remaining / length);
      reversed.push(interpolate(end, start, ratio));
      remaining = 0;
      break;
    }
    reversed.push(start);
    remaining -= length;
  }
  if (remaining > GEOMETRY_EPSILON_MM) return null;
  return reversed.reverse();
}

export function isFiniteContourPolyline(points: ReadonlyArray<Vec2>): boolean {
  return points.length >= KINEMATIC_DIVISOR && points.every(isFinitePoint);
}

function isFinitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function distance(left: Vec2, right: Vec2): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function direction(start: Vec2, end: Vec2): Vec2 | null {
  const length = distance(start, end);
  if (length <= GEOMETRY_EPSILON_MM) return null;
  return { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
}

function hasSameDirection(left: Vec2, right: Vec2): boolean {
  const dot = left.x * right.x + left.y * right.y;
  return dot >= 1 - DIRECTION_DOT_TOLERANCE;
}

function interpolate(from: Vec2, to: Vec2, ratio: number): Vec2 {
  return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
}
