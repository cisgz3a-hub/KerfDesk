import { pointInPolygon } from '../geometry';
import type { CncHelicalContourPass, CncPass } from '../job';
import type { CncHelixEntrySettings, Polyline, Vec2 } from '../scene';

export type HelicalEntryPlan =
  | { readonly ok: true; readonly passes: ReadonlyArray<CncPass> }
  | { readonly ok: false; readonly reason: string };

const MIN_ANGLE_DEG = 0.5;
const MAX_ANGLE_DEG = 15;
const EPSILON = 1e-7;

export function planHelicalPocketPasses(
  toolpaths: ReadonlyArray<Polyline>,
  depths: ReadonlyArray<number>,
  settings: CncHelixEntrySettings,
): HelicalEntryPlan {
  const requestIssue = helicalRequestIssue(toolpaths, settings);
  if (requestIssue !== null) return { ok: false, reason: requestIssue };
  const entryBoundary = largestRing(toolpaths);
  if (entryBoundary === null) {
    return { ok: false, reason: 'Helical entry could not identify a pocket boundary.' };
  }
  const boundarySign = Math.sign(signedArea(entryBoundary.points));
  if (
    toolpaths.some(
      (toolpath) =>
        Math.sign(signedArea(toolpath.points)) !== boundarySign ||
        !toolpathInsideBoundary(toolpath, entryBoundary),
    )
  ) {
    return {
      ok: false,
      reason: 'Helical entry currently requires one island-free pocket per layer.',
    };
  }
  const entries = toolpaths.map((toolpath) => entryForToolpath(toolpath, entryBoundary, settings));
  if (entries.some((entry) => entry === null)) {
    return { ok: false, reason: 'The configured minimum helix diameter does not fit this pocket.' };
  }

  const passes: CncPass[] = [];
  for (let depthIndex = 0; depthIndex < depths.length; depthIndex += 1) {
    const zMm = depths[depthIndex];
    if (zMm === undefined) continue;
    const startZMm = depthIndex === 0 ? 0 : (depths[depthIndex - 1] ?? 0);
    for (const entry of entries) {
      if (entry !== null) {
        passes.push(helicalPass(entry, startZMm, zMm, settings.angleDeg));
      }
    }
  }
  return { ok: true, passes };
}

function helicalRequestIssue(
  toolpaths: ReadonlyArray<Polyline>,
  settings: CncHelixEntrySettings,
): string | null {
  if (!validSettings(settings)) return 'Helix diameters and angle must be positive and finite.';
  if (settings.minDiameterMm > settings.maxDiameterMm) {
    return 'Helix minimum diameter exceeds its maximum diameter.';
  }
  return toolpaths.some((toolpath) => !toolpath.closed || toolpath.points.length < 3)
    ? 'Helical entry requires closed offset-pocket rings.'
    : null;
}

function largestRing(toolpaths: ReadonlyArray<Polyline>): Polyline | null {
  let largest: Polyline | null = null;
  let largestArea = 0;
  for (const toolpath of toolpaths) {
    const area = Math.abs(signedArea(toolpath.points));
    if (area > largestArea) {
      largest = toolpath;
      largestArea = area;
    }
  }
  return largest;
}

function toolpathInsideBoundary(toolpath: Polyline, boundary: Polyline): boolean {
  if (toolpath === boundary) return true;
  const probe = polygonCentroid(toolpath.points) ?? toolpath.points[0];
  return probe !== undefined && pointInPolygon(probe, boundary.points);
}

type EntryCircle = {
  readonly start: Vec2;
  readonly center: Vec2;
  readonly radiusMm: number;
  readonly polyline: ReadonlyArray<Vec2>;
};

function entryForToolpath(
  toolpath: Polyline,
  pocketBoundary: Polyline,
  settings: CncHelixEntrySettings,
): EntryCircle | null {
  const points = normalizedRingPoints(toolpath.points);
  const boundaryPoints = normalizedRingPoints(pocketBoundary.points);
  const orientation = Math.sign(signedArea(points));
  if (orientation === 0) return null;
  let best: EntryCircle | null = null;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (start === undefined || end === undefined) continue;
    const candidate = tangentEntryOnEdge(
      points,
      boundaryPoints,
      index,
      start,
      end,
      orientation,
      settings,
    );
    if (candidate !== null && (best === null || candidate.radiusMm > best.radiusMm + EPSILON)) {
      best = candidate;
    }
  }
  return best;
}

function helicalPass(
  entry: EntryCircle,
  startZMm: number,
  zMm: number,
  angleDeg: number,
): CncHelicalContourPass {
  const angle = Math.min(MAX_ANGLE_DEG, Math.max(MIN_ANGLE_DEG, angleDeg));
  const dropPerRevolution = Math.PI * 2 * entry.radiusMm * Math.tan((angle * Math.PI) / 180);
  const revolutions = Math.max(1, Math.ceil((startZMm - zMm) / dropPerRevolution));
  return {
    kind: 'helical-contour',
    start: entry.start,
    center: entry.center,
    clockwise: false,
    startZMm,
    zMm,
    revolutions,
    polyline: entry.polyline,
    closed: true,
  };
}

function tangentEntryOnEdge(
  ring: ReadonlyArray<Vec2>,
  pocketBoundary: ReadonlyArray<Vec2>,
  edgeIndex: number,
  edgeStart: Vec2,
  edgeEnd: Vec2,
  orientation: number,
  settings: CncHelixEntrySettings,
): EntryCircle | null {
  const dx = edgeEnd.x - edgeStart.x;
  const dy = edgeEnd.y - edgeStart.y;
  const edgeLength = Math.hypot(dx, dy);
  if (edgeLength <= EPSILON) return null;
  const start = { x: (edgeStart.x + edgeEnd.x) / 2, y: (edgeStart.y + edgeEnd.y) / 2 };
  const inward =
    orientation > 0
      ? { x: -dy / edgeLength, y: dx / edgeLength }
      : { x: dy / edgeLength, y: -dx / edgeLength };
  const minRadius = settings.minDiameterMm / 2;
  const maxRadius = settings.maxDiameterMm / 2;
  const circleAt = (radiusMm: number): EntryCircle => ({
    start,
    center: { x: start.x + inward.x * radiusMm, y: start.y + inward.y * radiusMm },
    radiusMm,
    polyline: reorderClosedRing(ring, edgeIndex, start),
  });
  const fits = (entry: EntryCircle): boolean =>
    pointInPolygon(entry.center, pocketBoundary) &&
    minimumEdgeDistance(entry.center, pocketBoundary) + EPSILON >= entry.radiusMm;

  const maximum = circleAt(maxRadius);
  if (fits(maximum)) return maximum;
  const minimum = circleAt(minRadius);
  if (!fits(minimum)) return null;

  let low = minRadius;
  let high = maxRadius;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (low + high) / 2;
    if (fits(circleAt(middle))) low = middle;
    else high = middle;
  }
  return circleAt(low);
}

function normalizedRingPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points[points.length - 1];
  return first !== undefined &&
    last !== undefined &&
    Math.hypot(first.x - last.x, first.y - last.y) <= EPSILON
    ? points.slice(0, -1)
    : points;
}

function reorderClosedRing(
  points: ReadonlyArray<Vec2>,
  edgeIndex: number,
  start: Vec2,
): ReadonlyArray<Vec2> {
  return [start, ...points.slice(edgeIndex + 1), ...points.slice(0, edgeIndex + 1), start];
}

function polygonCentroid(points: ReadonlyArray<Vec2>): Vec2 | null {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) continue;
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) <= EPSILON) return null;
  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

function signedArea(points: ReadonlyArray<Vec2>): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current !== undefined && next !== undefined) {
      twiceArea += current.x * next.y - next.x * current.y;
    }
  }
  return twiceArea / 2;
}

function minimumEdgeDistance(point: Vec2, polygon: ReadonlyArray<Vec2>): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (start === undefined || end === undefined) continue;
    minimum = Math.min(minimum, pointToSegmentDistance(point, start, end));
  }
  return minimum;
}

function pointToSegmentDistance(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function validSettings(settings: CncHelixEntrySettings): boolean {
  return (
    Number.isFinite(settings.maxDiameterMm) &&
    settings.maxDiameterMm > 0 &&
    Number.isFinite(settings.minDiameterMm) &&
    settings.minDiameterMm > 0 &&
    Number.isFinite(settings.angleDeg) &&
    settings.angleDeg > 0
  );
}
