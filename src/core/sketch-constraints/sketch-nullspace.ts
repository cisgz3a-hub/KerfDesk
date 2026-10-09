import { sketchAt } from './sketch-indexed';

/** RREF null directions for the bounded sketch Jacobian, including rotated singular starts. */
export function sketchNullspace(
  matrix: readonly (readonly number[])[],
  columns: number,
): number[][] {
  const rows = matrix.map((row) => [...row]);
  const pivots: number[] = [];
  for (let column = 0; column < columns && pivots.length < rows.length; column += 1) {
    const currentRow = pivots.length;
    let pivot = currentRow;
    for (let row = currentRow + 1; row < rows.length; row += 1)
      if (
        Math.abs(sketchAt(sketchAt(rows, row), column)) >
        Math.abs(sketchAt(sketchAt(rows, pivot), column))
      )
        pivot = row;
    const value = sketchAt(sketchAt(rows, pivot), column);
    if (Math.abs(value) <= 1e-10) continue;
    const before = sketchAt(rows, currentRow);
    rows[currentRow] = sketchAt(rows, pivot);
    rows[pivot] = before;
    const pivotRow = sketchAt(rows, currentRow);
    for (let j = column; j < columns; j += 1) pivotRow[j] = sketchAt(pivotRow, j) / value;
    for (let row = 0; row < rows.length; row += 1) {
      if (row === currentRow) continue;
      const target = sketchAt(rows, row);
      const scale = sketchAt(target, column);
      for (let j = column; j < columns; j += 1)
        target[j] = sketchAt(target, j) - scale * sketchAt(pivotRow, j);
    }
    pivots.push(column);
  }
  const pivotColumns = new Set(pivots);
  return Array.from({ length: columns }, (_, column) => column)
    .filter((column) => !pivotColumns.has(column))
    .map((column) => {
      const direction = Array<number>(columns).fill(0);
      direction[column] = 1;
      for (let row = 0; row < pivots.length; row += 1)
        direction[sketchAt(pivots, row)] = -sketchAt(sketchAt(rows, row), column);
      const length = Math.hypot(...direction);
      return direction.map((value) => value / length);
    });
}
