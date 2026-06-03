import {
  compileJob,
  estimateJobDuration,
  formatDuration,
  optimizePaths,
  type Job,
} from '../../core/job';
import {
  applyTransform,
  type ColoredPath,
  type Layer,
  type Project,
  type Scene,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { runPreEmitPreflight } from '../../core/preflight';

export const LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET = 10_000;
export const LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET = 20_000;
const MIN_FILL_ESTIMATE_HATCH_SPACING_MM = 0.05;

export type LiveJobEstimate =
  | { readonly kind: 'empty' }
  | { readonly kind: 'estimated'; readonly label: string }
  | { readonly kind: 'too-large' };

export function estimateLiveJob(project: Project): LiveJobEstimate {
  // A raster whose target grid blows the budget must short-circuit BEFORE the
  // compileJob below — the live estimate runs on every render, so otherwise it
  // allocates the giant resampled-luma + dither buffers and freezes the tab
  // (roadmap P1-A).
  if (!runPreEmitPreflight(project).ok) return { kind: 'too-large' };
  if (countOutputVectorSegments(project.scene) > LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }
  if (countEstimatedFillSegments(project.scene) > LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }

  const job = compileJob(project.scene, project.device);
  if (job.groups.length === 0) return { kind: 'empty' };
  if (countCompiledCutSegments(job) > LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }

  const result = estimateJobDuration(optimizePaths(job), project.device);
  return result.totalSeconds > 0
    ? { kind: 'estimated', label: formatDuration(result.totalSeconds) }
    : { kind: 'empty' };
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

function countEstimatedFillSegments(scene: Scene): number {
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
      if (count > LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET) return count;
    }
  }
  return count;
}

function countPathEstimatedHatches(path: ColoredPath, transform: Transform, layer: Layer): number {
  let count = 0;
  for (const polyline of path.polylines) {
    if (!isClosedEnough(polyline.points, polyline.closed)) continue;
    count += estimateHatchRows(polyline.points, transform, layer);
  }
  return count;
}

function vectorPaths(obj: SceneObject): ReadonlyArray<ColoredPath> {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
      return obj.paths;
    case 'raster-image':
      return [];
  }
}

function vectorTransform(obj: SceneObject): Transform | null {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
      return obj.transform;
    case 'raster-image':
      return null;
  }
}

function countPathSegments(path: ColoredPath): number {
  let count = 0;
  for (const polyline of path.polylines) {
    count += Math.max(0, polyline.points.length - 1);
  }
  return count;
}

function countCompiledCutSegments(job: Job): number {
  let count = 0;
  for (const group of job.groups) {
    if (group.kind === 'cut' || group.kind === 'fill') count += group.segments.length;
  }
  return count;
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

function isClosedEnough(points: ReadonlyArray<Vec2>, closed: boolean): boolean {
  if (points.length < 3) return false;
  if (closed) return true;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return false;
  return Math.abs(first.x - last.x) < 1e-4 && Math.abs(first.y - last.y) < 1e-4;
}
