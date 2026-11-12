import {
  captureLayerOperationSettings,
  createArtworkOperation,
  type Layer,
  type Scene,
  type SceneObject,
} from '../scene';
// Deep import: core/scene's barrel is ratcheted and may only shrink.
import {
  withoutCalibrationCouponOverrides,
  withoutInactiveLaserLeadSettings,
  withoutLaserLeadSettings,
} from '../scene/layer';
import { cloneRecipeCnc, type ProcessRecipeStep } from './process-recipe';
import { isRecord } from '../util/is-record';

export function recipeStepFromLayer(layer: Layer): ProcessRecipeStep {
  return {
    name: layer.name,
    color: layer.color,
    output: layer.output,
    visible: layer.visible,
    // Lead fields with both leads off change nothing (ADR-626). A calibration
    // coupon's direction overrides and marker stay with the coupon (T04-P2-1).
    settings: withoutCalibrationCouponOverrides(
      layer,
      withoutInactiveLaserLeadSettings(captureLayerOperationSettings(layer)),
    ),
    ...(layer.cnc === undefined ? {} : { cnc: cloneRecipeCnc(layer.cnc) }),
  };
}

export function templateOperation(
  scene: Scene,
  target: SceneObject,
  step: ProcessRecipeStep,
  current?: Layer,
): Layer {
  const seed = current ?? createArtworkOperation(scene, target, { name: step.name }).operation;
  // A recipe step without leads means no leads (ADR-626). A template operation
  // is never a calibration coupon: neither the operation it replaces nor an
  // older recipe step saved off a coupon passes on the coupon's marker or its
  // direction overrides (T04-P2-1).
  const { cnc: _cnc, scanOffsetCalibrationMode: _mode, ...plain } = withoutLaserLeadSettings(seed);
  return {
    ...withoutCalibrationCouponOverrides(seed, plain),
    ...withoutCalibrationCouponOverrides(step, step.settings),
    name: step.name,
    color: scene.layers.some((layer) => layer.id !== seed.id && layer.color === step.color)
      ? seed.color
      : step.color,
    output: step.output,
    visible: step.visible,
    ...(step.cnc === undefined ? {} : { cnc: cloneRecipeCnc(step.cnc) }),
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
  if (!isRecord(baseline) || !isRecord(current) || !isRecord(desired)) return current;
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
  if (!isRecord(baseline) || !isRecord(current)) return [prefix];
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  return [...keys].flatMap((key) =>
    changedLeaves(baseline[key], current[key], prefix === '' ? key : `${prefix}.${key}`),
  );
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
