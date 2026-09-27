import {
  applyTransform,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  isClosedEnough,
  type ColoredPath,
  type Layer,
  type Transform,
  type Vec2,
} from '../scene';
import { flattenColoredPathCurvesForTransform } from '../scene/curve-path';

export type FillPreparationEstimate =
  | { readonly kind: 'counted'; readonly segments: number }
  | { readonly kind: 'work-budget-exceeded' }
  | { readonly kind: 'invalid-input' };

const MIN_HATCH_SPACING_MM = 0.05;
// A classifier must not repeat the hatch compiler's quadratic work. This is
// a work limit for the estimate only; background output remains unrestricted.
const EDGE_SCAN_BUDGET = 1_000_000;

export type FillEstimateWorkBudget = { remainingEdgeScans: number };

export function createFillEstimateWorkBudget(): FillEstimateWorkBudget {
  return { remainingEdgeScans: EDGE_SCAN_BUDGET };
}

export function estimatePathFillSegments(
  path: ColoredPath,
  transform: Transform,
  layer: Layer,
  segmentBudget: number,
  workBudget: FillEstimateWorkBudget,
): FillPreparationEstimate {
  if (layer.fillStyle === 'offset') return counted(0);
  const flattened = flattenColoredPathCurvesForTransform(path, transform, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget,
  });
  if (flattened.kind !== 'ok') return { kind: 'work-budget-exceeded' };
  const contours = flattened.polylines
    .filter(isClosedEnough)
    .map((polyline) => polyline.points.map((point) => applyTransform(point, transform)));
  if (contours.length === 0) return counted(0);
  const primary = estimateHatchSegments(
    contours,
    layer.hatchAngleDeg,
    layer.hatchSpacingMm,
    segmentBudget,
    workBudget,
  );
  if (!layer.fillCrossHatch || primary.kind !== 'counted') return primary;
  const cross = estimateHatchSegments(
    contours,
    layer.hatchAngleDeg + 90,
    layer.hatchSpacingMm,
    segmentBudget,
    workBudget,
  );
  return cross.kind === 'counted' ? counted(primary.segments + cross.segments) : cross;
}

function estimateHatchSegments(
  contours: ReadonlyArray<ReadonlyArray<Vec2>>,
  angleDeg: number,
  spacingMm: number,
  segmentBudget: number,
  workBudget: FillEstimateWorkBudget,
): FillPreparationEstimate {
  if (!Number.isFinite(spacingMm)) return { kind: 'invalid-input' };
  const spacing = Math.max(MIN_HATCH_SPACING_MM, spacingMm);
  const angle = normalizeHatchAngle(angleDeg);
  const rad = (-angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotated = contours.map((points) =>
    points.map((point) => ({
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
    })),
  );
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const points of rotated) {
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return { kind: 'invalid-input' };
      }
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (maxY <= minY) return counted(0);
  const yStart = Math.ceil(minY / spacing) * spacing;
  const scanCount = Math.max(0, Math.floor((maxY - yStart) / spacing + 1e-6) + 1);
  const edgeCount = rotated.reduce((count, points) => count + points.length, 0);
  const edgeScans = edgeCount * scanCount;
  if (edgeScans > workBudget.remainingEdgeScans) return { kind: 'work-budget-exceeded' };
  workBudget.remainingEdgeScans -= edgeScans;
  let segments = 0;
  for (let scanIndex = 0; scanIndex < scanCount; scanIndex += 1) {
    const y = yStart + scanIndex * spacing;
    segments += hatchRowSegments(rotated, y);
    if (segments > segmentBudget) return counted(segments);
  }
  return counted(segments);
}

function hatchRowSegments(contours: ReadonlyArray<ReadonlyArray<Vec2>>, y: number): number {
  const intersections = hatchIntersections(contours, y).sort((a, b) => a - b);
  let segments = 0;
  for (let i = 0; i + 1 < intersections.length; i += 2) {
    const start = intersections[i];
    const end = intersections[i + 1];
    if (start !== undefined && end !== undefined && end - start >= 1e-6) segments += 1;
  }
  return segments;
}

function hatchIntersections(contours: ReadonlyArray<ReadonlyArray<Vec2>>, y: number): number[] {
  const intersections: number[] = [];
  for (const points of contours) {
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a === undefined || b === undefined) continue;
      const yLo = Math.min(a.y, b.y);
      const yHi = Math.max(a.y, b.y);
      if (yHi - yLo < 1e-6 || y < yLo || y >= yHi) continue;
      intersections.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  return intersections;
}

function normalizeHatchAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let angle = deg % 180;
  if (angle < 0) angle += 180;
  return angle;
}

function counted(segments: number): FillPreparationEstimate {
  return { kind: 'counted', segments };
}
