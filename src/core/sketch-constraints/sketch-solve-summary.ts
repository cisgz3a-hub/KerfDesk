import type { ConstrainedSketch2d, SketchSolveResult } from './constrained-sketch';
import { sketchAt } from './sketch-indexed';
import { sketchJacobian, type SketchEvaluator, type SketchDerivative } from './sketch-jacobian';
import { sketchMatrixRank } from './sketch-linear';
import { parseConstrainedSketch, SKETCH_MAX_RADIUS_MM } from './sketch-validation';
export const SKETCH_SOLVE_TOLERANCE_MM = 1e-5;
export function summarizeSketchSolve(
  sketch: ConstrainedSketch2d,
  inputValues: readonly number[],
  evaluate: SketchEvaluator,
  derivative?: SketchDerivative,
): SketchSolveResult {
  if (inputValues.some((value) => !Number.isFinite(value)))
    return { kind: 'invalid', reason: 'The sketch solve contains nonfinite coordinates.' };
  // Remove roundoff at the supported radius boundary before evaluating the retained result.
  const values = inputValues.map((value, index) =>
    index >= sketch.points.length * 2 &&
    value > SKETCH_MAX_RADIUS_MM &&
    value - SKETCH_MAX_RADIUS_MM <= SKETCH_SOLVE_TOLERANCE_MM / 2
      ? SKETCH_MAX_RADIUS_MM
      : value,
  );
  const residual = evaluate(values),
    maximumResidualMm = Math.max(0, ...residual.map((item) => Math.abs(item.value)));
  if (residual.some((item) => !Number.isFinite(item.value)))
    return {
      kind: 'invalid',
      reason: 'The sketch solve contains a nonfinite constraint residual.',
    };
  const jacobian = sketchJacobian(
    values,
    residual.map((item) => item.value),
    evaluate,
    derivative,
  );
  if (jacobian.some((row) => row.some((value) => !Number.isFinite(value))))
    return { kind: 'invalid', reason: 'The sketch solve contains a nonfinite derivative.' };
  const rank = sketchMatrixRank(jacobian, values.length);
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
  if (
    maximumResidualMm <= SKETCH_SOLVE_TOLERANCE_MM &&
    parseConstrainedSketch(solved).kind === 'invalid'
  )
    return {
      kind: 'invalid',
      reason: 'The solved sketch leaves the supported coordinate or radius range.',
    };
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
