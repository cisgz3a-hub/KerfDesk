import type { ConstrainedSketch2d, SketchSolveResult } from './constrained-sketch';
import { sketchAt } from './sketch-indexed';
import { sketchJacobian, type SketchEvaluator } from './sketch-jacobian';
import { sketchMatrixRank } from './sketch-linear';
export const SKETCH_SOLVE_TOLERANCE_MM = 1e-5;
export function summarizeSketchSolve(
  sketch: ConstrainedSketch2d,
  values: readonly number[],
  evaluate: SketchEvaluator,
): SketchSolveResult {
  const residual = evaluate(values),
    maximumResidualMm = Math.max(0, ...residual.map((item) => Math.abs(item.value)));
  const rank = sketchMatrixRank(
    sketchJacobian(
      values,
      residual.map((item) => item.value),
      evaluate,
    ),
    values.length,
  );
  const conflicts = new Map<string, number>();
  for (const item of residual)
    if (Math.abs(item.value) > SKETCH_SOLVE_TOLERANCE_MM)
      conflicts.set(item.id, Math.max(conflicts.get(item.id) ?? 0, Math.abs(item.value)));
  const solved = {
    ...sketch,
    points: sketch.points.map((point, index) => ({
      ...point,
      x: sketchAt(values, index * 2),
      y: sketchAt(values, index * 2 + 1),
    })),
    circles: sketch.circles.map((circle, index) => ({
      ...circle,
      radiusMm: sketchAt(values, sketch.points.length * 2 + index),
    })),
  };
  if (solved.circles.some((circle) => circle.radiusMm <= 0))
    return { kind: 'invalid', reason: 'The solved circle diameter is not positive.' };
  return {
    kind: 'solved',
    status:
      maximumResidualMm > SKETCH_SOLVE_TOLERANCE_MM
        ? 'over-constrained'
        : rank < values.length
          ? 'under-constrained'
          : 'fully-constrained',
    sketch: solved,
    degreesOfFreedom: values.length - rank,
    redundantEquations: Math.max(0, residual.length - rank),
    maximumResidualMm,
    conflicts: [...conflicts].map(([constraintId, residualMm]) => ({ constraintId, residualMm })),
  };
}
