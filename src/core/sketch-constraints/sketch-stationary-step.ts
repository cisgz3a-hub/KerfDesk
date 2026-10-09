import { sketchAt } from './sketch-indexed';
import type { SketchEvaluator, SketchResidual } from './sketch-jacobian';
import { sketchNullspace } from './sketch-nullspace';

/** A collinear distance can be stationary in a perpendicular direction despite a feasible solve. */
export function sketchStationaryStep(
  values: readonly number[],
  jacobian: readonly (readonly number[])[],
  residual: readonly SketchResidual[],
  evaluate: SketchEvaluator,
): number[] | null {
  const cost = sketchResidualCost(residual);
  const step = Math.max(
    1e-3,
    Math.min(1000, Math.max(0, ...residual.map((item) => Math.abs(item.value)))),
  );
  // Nullspace directions preserve all current first-order relations. Trying both
  // signs avoids assigning an orientation to a still-undetermined branch.
  for (const direction of sketchNullspace(jacobian, values.length)) {
    for (const sign of [1, -1]) {
      const trial = values.map((value, index) => value + sign * step * sketchAt(direction, index));
      if (trial.some((value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000)) continue;
      const trialCost = sketchResidualCost(evaluate(trial));
      if (Number.isFinite(trialCost) && trialCost < cost - Math.max(1e-12, cost * 1e-12))
        return trial;
    }
  }
  return null;
}
export function sketchResidualCost(residual: readonly SketchResidual[]): number {
  return residual.reduce((sum, item) => sum + item.value ** 2, 0);
}
