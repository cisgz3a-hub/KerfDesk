import { sketchAt } from './sketch-indexed';
/** Pivoted elimination for small bounded normal systems; no global solver state. */
export function solveSketchLinear(
  matrix: readonly (readonly number[])[],
  rhs: readonly number[],
): number[] | null {
  const n = rhs.length,
    rows = matrix.map((row, i) => [...row, sketchAt(rhs, i)]);
  for (let col = 0; col < n; col += 1) {
    const pivot = largestPivot(rows, col, col);
    if (Math.abs(sketchAt(sketchAt(rows, pivot), col)) < 1e-14) return null;
    swapRows(rows, col, pivot);
    const pivotRow = sketchAt(rows, col),
      value = sketchAt(pivotRow, col);
    for (let j = col; j <= n; j += 1) pivotRow[j] = sketchAt(pivotRow, j) / value;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const current = sketchAt(rows, row),
        scale = sketchAt(current, col);
      subtractRow(current, pivotRow, scale, col, n + 1);
    }
  }
  return rows.map((row) => sketchAt(row, n));
}
export function sketchMatrixRank(matrix: readonly (readonly number[])[], columns: number): number {
  const rows = matrix.map((row) => [...row]);
  let rank = 0;
  for (let col = 0; col < columns && rank < rows.length; col += 1) {
    const pivot = largestPivot(rows, rank, col);
    if (Math.abs(sketchAt(sketchAt(rows, pivot), col)) < 1e-7) continue;
    swapRows(rows, rank, pivot);
    const pivotRow = sketchAt(rows, rank),
      scale = sketchAt(pivotRow, col);
    for (let j = col; j < columns; j += 1) pivotRow[j] = sketchAt(pivotRow, j) / scale;
    for (let row = rank + 1; row < rows.length; row += 1) {
      const current = sketchAt(rows, row);
      subtractRow(current, pivotRow, sketchAt(current, col), col, columns);
    }
    rank += 1;
  }
  return rank;
}
function largestPivot(rows: readonly (readonly number[])[], start: number, col: number): number {
  let pivot = start;
  for (let row = start + 1; row < rows.length; row += 1)
    if (
      Math.abs(sketchAt(sketchAt(rows, row), col)) > Math.abs(sketchAt(sketchAt(rows, pivot), col))
    )
      pivot = row;
  return pivot;
}
function swapRows(rows: number[][], first: number, second: number): void {
  const before = sketchAt(rows, first);
  rows[first] = sketchAt(rows, second);
  rows[second] = before;
}
function subtractRow(
  current: number[],
  pivot: readonly number[],
  scale: number,
  start: number,
  end: number,
): void {
  for (let column = start; column < end; column += 1)
    current[column] = sketchAt(current, column) - scale * sketchAt(pivot, column);
}
