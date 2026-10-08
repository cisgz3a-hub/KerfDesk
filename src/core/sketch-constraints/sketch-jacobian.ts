import { sketchAt } from './sketch-indexed';
export type SketchResidual = { readonly id: string; readonly value: number };
export type SketchEvaluator = (values: readonly number[]) => readonly SketchResidual[];
export function sketchJacobian(
  values: readonly number[],
  residual: readonly number[],
  evaluate: SketchEvaluator,
): number[][] {
  const result = residual.map(() => Array<number>(values.length).fill(0));
  for (let column = 0; column < values.length; column += 1) {
    const step = Math.max(1e-6, Math.abs(sketchAt(values, column)) * 1e-7),
      trial = [...values];
    trial[column] = sketchAt(trial, column) + step;
    const next = evaluate(trial);
    for (let row = 0; row < residual.length; row += 1)
      sketchAt(result, row)[column] = (sketchAt(next, row).value - sketchAt(residual, row)) / step;
  }
  return result;
}
export function sketchNormalSystem(
  jacobian: readonly (readonly number[])[],
  residual: readonly SketchResidual[],
  size: number,
  damping: number,
): { readonly normal: number[][]; readonly rhs: number[] } {
  const normal = Array.from({ length: size }, () => Array<number>(size).fill(0)),
    rhs = Array<number>(size).fill(0);
  for (let row = 0; row < jacobian.length; row += 1) {
    const coefficients = sketchAt(jacobian, row),
      value = sketchAt(residual, row).value;
    for (let i = 0; i < size; i += 1) {
      rhs[i] = sketchAt(rhs, i) - sketchAt(coefficients, i) * value;
      const current = sketchAt(normal, i);
      for (let j = 0; j < size; j += 1)
        current[j] = sketchAt(current, j) + sketchAt(coefficients, i) * sketchAt(coefficients, j);
    }
  }
  for (let i = 0; i < size; i += 1)
    sketchAt(normal, i)[i] = sketchAt(sketchAt(normal, i), i) + damping;
  return { normal, rhs };
}
