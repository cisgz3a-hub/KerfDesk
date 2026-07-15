// preparation-complexity - cheap scene counters used before expensive compile
// paths. These guards deliberately run on raw Scene data so UI-only checks like
// live estimates and Preview can avoid fill hatching / path optimization when
// a design is obviously too large for synchronous preparation.

import {
  applyTransform,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenColoredPathCurves,
  isClosedEnough,
  outputOperationLayers,
  pathUsesOperation,
  type ColoredPath,
  type Layer,
  type Scene,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../scene';

export const PREPARATION_RAW_VECTOR_SEGMENT_BUDGET = 100_000;
export const PREPARATION_COMPILED_SEGMENT_BUDGET = 20_000;

const MIN_FILL_ESTIMATE_HATCH_SPACING_MM = 0.05;

export function scenePreparationTooComplex(scene: Scene): boolean {
  return (
    countOutputVectorSegments(scene) > PREPARATION_RAW_VECTOR_SEGMENT_BUDGET ||
    countEstimatedFillSegments(scene) > PREPARATION_COMPILED_SEGMENT_BUDGET
  );
}

export function countOutputVectorSegments(scene: Scene): number {
  let count = 0;
  for (const layer of scene.layers.flatMap(outputOperationLayers)) {
    for (const obj of scene.objects) {
      if (effectiveLayer(layer, obj).mode === 'image') continue;
      for (const path of vectorPaths(obj)) {
        if (!pathUsesOperation(obj, path, layer)) continue;
        count += countPathSegments(path);
      }
    }
  }
  return count;
}

export function countEstimatedFillSegments(scene: Scene): number {
  let count = 0;
  for (const layer of scene.layers.flatMap(outputOperationLayers)) {
    for (const obj of scene.objects) {
      const transform = vectorTransform(obj);
      const operation = effectiveLayer(layer, obj);
      if (transform === null || operation.mode !== 'fill') continue;
      for (const path of vectorPaths(obj)) {
        if (!pathUsesOperation(obj, path, layer)) continue;
        count += countPathEstimatedHatches(path, transform, operation);
        if (count > PREPARATION_COMPILED_SEGMENT_BUDGET) return count;
      }
    }
  }
  return count;
}

function effectiveLayer(layer: Layer, object: SceneObject): Layer {
  return object.operationOverride === undefined ? layer : { ...layer, ...object.operationOverride };
}

function countPathEstimatedHatches(path: ColoredPath, transform: Transform, layer: Layer): number {
  if (layer.fillStyle === 'offset') return 0;
  const contours = path.polylines
    .filter(isClosedEnough)
    .map((polyline) => polyline.points.map((point) => applyTransform(point, transform)));
  if (contours.length === 0) return 0;
  const primary = estimateHatchSegments(contours, layer.hatchAngleDeg, layer.hatchSpacingMm);
  return layer.fillCrossHatch
    ? primary + estimateHatchSegments(contours, layer.hatchAngleDeg + 90, layer.hatchSpacingMm)
    : primary;
}

function vectorPaths(obj: SceneObject): ReadonlyArray<ColoredPath> {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return obj.paths;
    case 'raster-image':
    case 'relief':
      return [];
  }
}

function vectorTransform(obj: SceneObject): Transform | null {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return obj.transform;
    case 'raster-image':
    case 'relief':
      return null;
  }
}

function countPathSegments(path: ColoredPath): number {
  const flattened = flattenColoredPathCurves(path, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: PREPARATION_RAW_VECTOR_SEGMENT_BUDGET,
  });
  return flattened.kind === 'ok'
    ? flattened.segmentCount
    : PREPARATION_RAW_VECTOR_SEGMENT_BUDGET + 1;
}

function estimateHatchSegments(
  contours: ReadonlyArray<ReadonlyArray<Vec2>>,
  angleDeg: number,
  spacingMm: number,
): number {
  const spacing = Math.max(MIN_FILL_ESTIMATE_HATCH_SPACING_MM, spacingMm);
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
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY <= minY) return 0;
  const yStart = Math.ceil(minY / spacing) * spacing;
  const scanCount = Math.max(0, Math.floor((maxY - yStart) / spacing + 1e-6) + 1);
  let segments = 0;
  for (let scanIndex = 0; scanIndex < scanCount; scanIndex += 1) {
    const y = yStart + scanIndex * spacing;
    const intersections = hatchIntersections(rotated, y).sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const start = intersections[i];
      const end = intersections[i + 1];
      if (start !== undefined && end !== undefined && end - start >= 1e-6) segments += 1;
    }
    if (segments > PREPARATION_COMPILED_SEGMENT_BUDGET) return segments;
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
