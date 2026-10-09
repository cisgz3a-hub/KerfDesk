import type { ConstrainedSketch2d, SketchSolveResult } from './constrained-sketch';
import { parseConstrainedSketch } from './sketch-validation';
import { sketchEquations } from './sketch-equations';
import { solveSketchLinear } from './sketch-linear';
import { sketchAt } from './sketch-indexed';
import { sketchResidualCost, sketchStationaryStep } from './sketch-stationary-step';
import { sketchNormalSystem, type SketchEvaluator, type SketchDerivative } from './sketch-jacobian';
import { summarizeSketchSolve, SKETCH_SOLVE_TOLERANCE_MM } from './sketch-solve-summary';
/** Bounded local least-squares solve. A conflict result is never committed as geometry. */
export function solveConstrainedSketch(input: ConstrainedSketch2d): SketchSolveResult {
  const validated = parseConstrainedSketch(input);
  if (validated.kind === 'invalid') return validated;
  const equations = sketchEquations(validated.sketch);
  if (equations.kind === 'error') return { kind: 'invalid', reason: equations.reason };
  const refined = refineSketch(equations.initial, equations.evaluate, equations.derivative);
  return refined.kind === 'invalid'
    ? refined
    : summarizeSketchSolve(
        validated.sketch,
        refined.values,
        equations.evaluate,
        equations.derivative,
      );
}
function refineSketch(
  initial: readonly number[],
  evaluate: SketchEvaluator,
  derivative: SketchDerivative,
):
  | { readonly kind: 'ok'; readonly values: readonly number[] }
  | { readonly kind: 'invalid'; readonly reason: string } {
  let values = [...initial],
    damping = 1e-6,
    escapes = 0;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const residual = evaluate(values);
    if (residual.every((item) => Math.abs(item.value) <= SKETCH_SOLVE_TOLERANCE_MM / 10)) break;
    const jacobian = derivative(values);
    const system = sketchNormalSystem(jacobian, residual, values.length, damping);
    const delta = solveSketchLinear(system.normal, system.rhs);
    if (delta === null) break;
    const trial = values.map((value, index) => value + sketchAt(delta, index));
    const oldCost = sketchResidualCost(residual),
      next = evaluate(trial),
      cost = sketchResidualCost(next);
    if (trial.some((value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000))
      return { kind: 'invalid', reason: 'The sketch solve leaves the supported coordinate range.' };
    if (cost < oldCost) {
      values = trial;
      damping = Math.max(1e-10, damping / 3);
    } else {
      damping *= 10;
      if (damping > 1e8) {
        const escaped =
          escapes < 3 ? sketchStationaryStep(values, jacobian, residual, evaluate) : null;
        if (escaped === null) break;
        values = escaped;
        damping = 1e-6;
        escapes += 1;
      }
    }
  }
  return { kind: 'ok', values };
}
