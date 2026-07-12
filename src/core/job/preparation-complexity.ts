// preparation-complexity - cheap scene counters used before expensive compile
// paths. These guards deliberately run on raw Scene data so UI-only checks like
// live estimates and Preview can avoid fill hatching / path optimization when
// a design is obviously too large for synchronous preparation.

import {
  applyTransform,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenColoredPathCurves,
  isClosedEnough,
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
  const outputLayers = outputVectorLayersByColor(scene.layers);
  if (outputLayers.size === 0) return 0;
  let count = 0;
  for (const obj of scene.objects) {
    for (const path of vectorPaths(obj)) {
      if (!outputLayers.has(path.color)) continue;
      count += countPathSegments(path);
    }
  }
  return count;
}

export function countEstimatedFillSegments(scene: Scene): number {
  const outputLayers = outputFillLayersByColor(scene.layers);
  if (outputLayers.size === 0) return 0;
  let count = 0;
  for (const obj of scene.objects) {
    const transform = vectorTransform(obj);
    if (transform === null) continue;
    for (const path of vectorPaths(obj)) {
      const layer = outputLayers.get(path.color);
      if (layer === undefined) continue;
      count += countPathEstimatedHatches(path, transform, layer);
      if (count > PREPARATION_COMPILED_SEGMENT_BUDGET) return count;
    }
  }
  return count;
}

function outputVectorLayersByColor(layers: ReadonlyArray<Layer>): ReadonlyMap<string, Layer> {
  const out = new Map<string, Layer>();
  for (const layer of layers) {
    if (layer.output && layer.mode !== 'image') out.set(layer.color, layer);
  }
  return out;
}

function outputFillLayersByColor(layers: ReadonlyArray<Layer>): ReadonlyMap<string, Layer> {
  const out = new Map<string, Layer>();
  for (const layer of layers) {
    if (layer.output && layer.mode === 'fill') out.set(layer.color, layer);
  }
  return out;
}

function countPathEstimatedHatches(path: ColoredPath, transform: Transform, layer: Layer): number {
  let count = 0;
  for (const polyline of path.polylines) {
    if (!isClosedEnough(polyline)) continue;
    count += estimateHatchRows(polyline.points, transform, layer);
  }
  return count;
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

function estimateHatchRows(
  points: ReadonlyArray<Vec2>,
  transform: Transform,
  layer: Layer,
): number {
  const spacing = Math.max(MIN_FILL_ESTIMATE_HATCH_SPACING_MM, layer.hatchSpacingMm);
  const angle = normalizeHatchAngle(layer.hatchAngleDeg);
  const rad = (-angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const transformed = applyTransform(point, transform);
    const y = transformed.x * sin + transformed.y * cos;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY <= minY) return 0;
  return Math.floor((maxY - minY) / spacing) + 1;
}

function normalizeHatchAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let angle = deg % 180;
  if (angle < 0) angle += 180;
  return angle;
}
