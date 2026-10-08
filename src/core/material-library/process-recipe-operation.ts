import {
  captureLayerOperationSettings,
  createArtworkOperation,
  type Layer,
  type Scene,
  type SceneObject,
} from '../scene';
import { cloneRecipeCnc, type ProcessRecipeStep } from './process-recipe';

export function recipeStepFromLayer(layer: Layer): ProcessRecipeStep {
  return {
    name: layer.name,
    color: layer.color,
    output: layer.output,
    visible: layer.visible,
    settings: captureLayerOperationSettings(layer),
    ...(layer.cnc === undefined ? {} : { cnc: cloneRecipeCnc(layer.cnc) }),
    ...(layer.scanOffsetCalibrationMode === undefined
      ? {}
      : { scanOffsetCalibrationMode: layer.scanOffsetCalibrationMode }),
  };
}

export function templateOperation(
  scene: Scene,
  target: SceneObject,
  step: ProcessRecipeStep,
  current?: Layer,
): Layer {
  const seed = current ?? createArtworkOperation(scene, target, { name: step.name }).operation;
  const { cnc: _cnc, scanOffsetCalibrationMode: _mode, ...plain } = seed;
  return {
    ...plain,
    ...step.settings,
    name: step.name,
    color: scene.layers.some((layer) => layer.id !== seed.id && layer.color === step.color)
      ? seed.color
      : step.color,
    output: step.output,
    visible: step.visible,
    ...(step.cnc === undefined ? {} : { cnc: cloneRecipeCnc(step.cnc) }),
    ...(step.scanOffsetCalibrationMode === undefined
      ? {}
      : { scanOffsetCalibrationMode: step.scanOffsetCalibrationMode }),
  };
}

/** A three-way update: changed operator fields win, unchanged values follow the new recipe. */
export function preserveRecipeStepEdits(
  baseline: ProcessRecipeStep,
  current: ProcessRecipeStep,
  desired: ProcessRecipeStep,
): ProcessRecipeStep {
  return mergeUnedited(baseline, current, desired) as ProcessRecipeStep;
}

export function recipeStepEditedFields(
  baseline: ProcessRecipeStep,
  current: ProcessRecipeStep,
): string[] {
  return changedLeaves(baseline, current).filter((key) => key !== 'dependsOn');
}

function mergeUnedited(baseline: unknown, current: unknown, desired: unknown): unknown {
  if (same(baseline, current)) return desired;
  if (!record(baseline) || !record(current) || !record(desired)) return current;
  const keys = new Set([
    ...Object.keys(baseline),
    ...Object.keys(current),
    ...Object.keys(desired),
  ]);
  return Object.fromEntries(
    [...keys].flatMap((key) => {
      const next = mergeUnedited(baseline[key], current[key], desired[key]);
      return next === undefined ? [] : [[key, next]];
    }),
  );
}
function changedLeaves(baseline: unknown, current: unknown, prefix = ''): string[] {
  if (same(baseline, current)) return [];
  if (!record(baseline) || !record(current)) return [prefix];
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  return [...keys].flatMap((key) =>
    changedLeaves(baseline[key], current[key], prefix === '' ? key : `${prefix}.${key}`),
  );
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
