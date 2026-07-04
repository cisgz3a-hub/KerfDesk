/**
 * Dense Gauss-Jordan elimination with partial pivoting for small square
 * systems. Pure: no I/O, clock, or randomness. Returns `null` for a singular
 * (degenerate) system instead of throwing, so callers branch on a value
 * rather than catch an exception (CLAUDE.md "Throwing for control flow").
 */

// Pivots smaller than this in magnitude are treated as zero, i.e. the system
// is singular. The homography systems we build use mm/pixel coordinates whose
// non-degenerate pivots are many orders of magnitude above this floor.
const PIVOT_EPSILON = 1e-12;

/**
 * Solve the `n`-unknown system whose augmented matrix is `rows` — each row is
 * `n` coefficients followed by one right-hand-side value (length `n + 1`).
 * Reduces `rows` to diagonal form in place. Returns the solution vector, or
 * `null` if the system is singular within {@link PIVOT_EPSILON}.
 */
export function solveLinearSystem(rows: number[][], n: number): number[] | null {
  for (let col = 0; col < n; col += 1) {
    const pivot = selectPivot(rows, col, n);
    if (pivot === null) return null;
    swapRows(rows, col, pivot);
    if (!eliminateColumn(rows, col, n)) return null;
  }
  return extractSolution(rows, n);
}

function selectPivot(rows: number[][], col: number, n: number): number | null {
  let bestRow: number | null = null;
  let bestAbs = PIVOT_EPSILON;
  for (let r = col; r < n; r += 1) {
    const row = rows[r];
    if (row === undefined) return null;
    const value = row[col];
    if (value === undefined) return null;
    const magnitude = Math.abs(value);
    if (magnitude > bestAbs) {
      bestAbs = magnitude;
      bestRow = r;
    }
  }
  return bestRow;
}

function swapRows(rows: number[][], a: number, b: number): void {
  const rowA = rows[a];
  const rowB = rows[b];
  if (rowA === undefined || rowB === undefined) return;
  rows[a] = rowB;
  rows[b] = rowA;
}

function eliminateColumn(rows: number[][], col: number, n: number): boolean {
  const pivotRow = rows[col];
  if (pivotRow === undefined) return false;
  const pivotValue = pivotRow[col];
  if (pivotValue === undefined || Math.abs(pivotValue) < PIVOT_EPSILON) return false;
  for (let r = 0; r < n; r += 1) {
    if (r === col) continue;
    const row = rows[r];
    if (row === undefined) return false;
    const factor = (row[col] ?? 0) / pivotValue;
    for (let c = col; c <= n; c += 1) {
      row[c] = (row[c] ?? 0) - factor * (pivotRow[c] ?? 0);
    }
  }
  return true;
}

function extractSolution(rows: number[][], n: number): number[] | null {
  const solution: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const row = rows[i];
    if (row === undefined) return null;
    const diagonal = row[i];
    const rhs = row[n];
    if (diagonal === undefined || rhs === undefined) return null;
    if (Math.abs(diagonal) < PIVOT_EPSILON) return null;
    solution.push(rhs / diagonal);
  }
  return solution;
}
