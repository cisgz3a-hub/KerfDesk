import {
  compileJob,
  estimateJobDuration,
  formatDuration,
  optimizePaths,
  type Job,
} from '../../core/job';
import type { ColoredPath, Layer, Project, Scene, SceneObject } from '../../core/scene';

export const LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET = 10_000;
export const LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET = 20_000;

export type LiveJobEstimate =
  | { readonly kind: 'empty' }
  | { readonly kind: 'estimated'; readonly label: string }
  | { readonly kind: 'too-large' };

export function estimateLiveJob(project: Project): LiveJobEstimate {
  if (countOutputVectorSegments(project.scene) > LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET) {
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
    if (group.kind === 'cut') count += group.segments.length;
  }
  return count;
}
