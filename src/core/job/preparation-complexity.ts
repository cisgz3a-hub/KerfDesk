// preparation-complexity - cheap scene counters used before expensive compile
// paths. These guards deliberately run on raw Scene data so UI-only checks like
// live estimates and Preview can avoid fill hatching / path optimization when
// a design is obviously too large for synchronous preparation.

import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  outputOperationLayers,
  pathUsesOperation,
  type ColoredPath,
  type Layer,
  type Project,
  type Scene,
  type SceneObject,
  type Transform,
} from '../scene';
import { flattenColoredPathCurvesForTransform } from '../scene/curve-path';
import { effectiveOperationForObject } from '../effective-output';
import { sceneHasVCarveOutputLayer } from './vcarve-preparation-complexity';
import {
  createFillEstimateWorkBudget,
  estimatePathFillSegments,
  type FillPreparationEstimate,
} from './fill-preparation-estimate';

export const PREPARATION_RAW_VECTOR_SEGMENT_BUDGET = 100_000;
export const PREPARATION_COMPILED_SEGMENT_BUDGET = 20_000;

// Advisory for scene size. Amplifying operations have their own output and UI
// routing policy below; this predicate does not refuse executable output.
export function scenePreparationTooComplex(scene: Scene): boolean {
  return (
    countOutputVectorSegments(scene) > PREPARATION_RAW_VECTOR_SEGMENT_BUDGET ||
    countEstimatedFillSegments(scene) > PREPARATION_COMPILED_SEGMENT_BUDGET
  );
}

/**
 * Selects background output preparation when compile/emission amplification
 * would make a geometrically small project expensive. This is routing only:
 * projects over the budget still compile and emit in full.
 */
export function outputVectorPreparationTooComplex(
  project: Project,
  rawVectorSegmentBudget = PREPARATION_RAW_VECTOR_SEGMENT_BUDGET,
): boolean {
  if (project.machine?.kind === 'cnc') {
    return (
      cncVectorPreparationWorkUnits(project.scene, rawVectorSegmentBudget) >= rawVectorSegmentBudget
    );
  }
  return (
    laserVectorPreparationWorkUnits(project.scene, rawVectorSegmentBudget) >=
      rawVectorSegmentBudget ||
    laserFillPreparationWorkUnits(project.scene) >= PREPARATION_COMPILED_SEGMENT_BUDGET
  );
}

export function countOutputVectorSegments(scene: Scene): number {
  let count = 0;
  for (const layer of scene.layers.flatMap(outputOperationLayers)) {
    for (const obj of scene.objects) {
      if (effectiveLayer(layer, obj).mode === 'image') continue;
      for (const path of vectorPaths(obj)) {
        if (!pathUsesOperation(obj, path, layer)) continue;
        const transform = vectorTransform(obj);
        if (transform !== null) count += countPathSegments(path, transform);
      }
    }
  }
  return count;
}

/** Infinity means the estimate was too expensive or invalid, not a span count. */
export function countEstimatedFillSegments(scene: Scene): number {
  const estimate = estimateFillPreparation(scene);
  return estimate.kind === 'counted' ? estimate.segments : Number.POSITIVE_INFINITY;
}

export function estimateFillPreparation(scene: Scene): FillPreparationEstimate {
  let count = 0;
  const workBudget = createFillEstimateWorkBudget();
  for (const layer of scene.layers.flatMap(outputOperationLayers)) {
    for (const obj of scene.objects) {
      const transform = vectorTransform(obj);
      const operation = effectiveLayer(layer, obj);
      if (transform === null || operation.mode !== 'fill') continue;
      for (const path of vectorPaths(obj)) {
        if (!pathUsesOperation(obj, path, layer)) continue;
        const estimate = estimatePathFillSegments(
          path,
          transform,
          operation,
          PREPARATION_COMPILED_SEGMENT_BUDGET,
          workBudget,
        );
        if (estimate.kind !== 'counted') return estimate;
        count += estimate.segments;
        if (count > PREPARATION_COMPILED_SEGMENT_BUDGET)
          return { kind: 'counted', segments: count };
      }
    }
  }
  return { kind: 'counted', segments: count };
}

function laserVectorPreparationWorkUnits(scene: Scene, segmentBudget: number): number {
  let count = 0;
  for (const layer of scene.layers.flatMap(outputOperationLayers)) {
    for (const obj of scene.objects) {
      const operation = effectiveLayer(layer, obj);
      if (operation.mode === 'image') continue;
      const passes = laserPassCount(operation.passes);
      for (const path of vectorPaths(obj)) {
        if (!pathUsesOperation(obj, path, layer)) continue;
        const transform = vectorTransform(obj);
        if (transform !== null) count += countPathSegments(path, transform, segmentBudget) * passes;
        if (count >= segmentBudget) return count;
      }
    }
  }
  return count;
}

function laserFillPreparationWorkUnits(scene: Scene): number {
  let count = 0;
  const workBudget = createFillEstimateWorkBudget();
  for (const layer of scene.layers.flatMap(outputOperationLayers)) {
    for (const obj of scene.objects) {
      const transform = vectorTransform(obj);
      const operation = effectiveLayer(layer, obj);
      if (transform === null || operation.mode !== 'fill') continue;
      const passes = laserPassCount(operation.passes);
      for (const path of vectorPaths(obj)) {
        if (!pathUsesOperation(obj, path, layer)) continue;
        const estimate = estimatePathFillSegments(
          path,
          transform,
          operation,
          PREPARATION_COMPILED_SEGMENT_BUDGET,
          workBudget,
        );
        if (estimate.kind !== 'counted') return Number.POSITIVE_INFINITY;
        count += estimate.segments * passes;
        if (count >= PREPARATION_COMPILED_SEGMENT_BUDGET) return count;
      }
    }
  }
  return count;
}

function cncVectorPreparationWorkUnits(scene: Scene, segmentBudget: number): number {
  // Segments times depth passes describes profile and pocket, which trace the
  // artwork once per pass. V-carve is not proportional to its input at all, so
  // it books the whole budget rather than being counted.
  if (sceneHasVCarveOutputLayer(scene)) return segmentBudget;
  let count = 0;
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    const depthPasses = cncDepthPassCount(layer);
    for (const obj of scene.objects) {
      for (const path of vectorPaths(obj)) {
        if (!pathUsesOperation(obj, path, layer)) continue;
        const transform = vectorTransform(obj);
        if (transform !== null)
          count += countPathSegments(path, transform, segmentBudget) * depthPasses;
        if (count >= segmentBudget) return count;
      }
    }
  }
  return count;
}

function laserPassCount(passes: number): number {
  return Number.isFinite(passes) ? Math.max(1, Math.floor(passes)) : Number.POSITIVE_INFINITY;
}

function cncDepthPassCount(layer: Layer): number {
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  if (!Number.isFinite(settings.depthMm) || settings.depthMm <= 0) return 0;
  const primaryPasses = depthPassCount(settings.depthMm, settings.depthPerPassMm);
  // Secondary/finish stages can use much finer depth steps than the primary
  // cutter. Add their work, rather than taking the largest ladder, because
  // both execute. Inactive or mismatched stored recipes may over-route to a
  // worker; this conservative classifier never changes executable pass counts.
  return Object.values(settings.stageRecipes ?? {}).reduce(
    (passes, recipe) => passes + depthPassCount(settings.depthMm, recipe.depthPerPassMm),
    primaryPasses,
  );
}

function depthPassCount(depthMm: number, requestedDepthPerPassMm: number): number {
  const depthPerPassMm =
    Number.isFinite(requestedDepthPerPassMm) && requestedDepthPerPassMm > 0
      ? Math.min(requestedDepthPerPassMm, depthMm)
      : depthMm;
  return Math.max(1, Math.ceil(depthMm / depthPerPassMm - 1e-9));
}

function effectiveLayer(layer: Layer, object: SceneObject): Layer {
  return effectiveOperationForObject(layer, object);
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

function countPathSegments(
  path: ColoredPath,
  transform: Transform,
  segmentBudget = PREPARATION_RAW_VECTOR_SEGMENT_BUDGET,
): number {
  const flattened = flattenColoredPathCurvesForTransform(path, transform, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget,
  });
  return flattened.kind === 'ok' ? flattened.segmentCount : segmentBudget + 1;
}
