// Dense Cholesky factorisation for the small symmetric positive-definite
// systems the camera fits produce (a few hundred unknowns at most). Pure core.

/**
 * Solve `a · x = b` for symmetric positive-definite `a` (row-major n×n).
 * Returns null when `a` is not positive definite, so the caller can raise its
 * damping and retry instead of taking a garbage step.
 */
export function choleskySolve(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  n: number,
): Float64Array | null {
  const l = choleskyFactor(a, n);
  return l === null ? null : solveWithFactor(l, b, n);
}

function solveWithFactor(l: Float64Array, b: ArrayLike<number>, n: number): Float64Array {
  return backSubstitute(l, forwardSubstitute(l, b, n), n);
}

/** y with L·y = b. */
function forwardSubstitute(l: Float64Array, b: ArrayLike<number>, n: number): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = b[i] ?? 0;
    for (let k = 0; k < i; k += 1) sum -= (l[i * n + k] ?? 0) * (y[k] ?? 0);
    y[i] = sum / (l[i * n + i] ?? 1);
  }
  return y;
}

/** x with Lᵀ·x = y. */
function backSubstitute(l: Float64Array, y: Float64Array, n: number): Float64Array {
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = y[i] ?? 0;
    for (let k = i + 1; k < n; k += 1) sum -= (l[k * n + i] ?? 0) * (x[k] ?? 0);
    x[i] = sum / (l[i * n + i] ?? 1);
  }
  return x;
}

/** Lower-triangular factor L with a = L·Lᵀ, or null if `a` is not positive definite. */
export function choleskyFactor(a: ArrayLike<number>, n: number): Float64Array | null {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = a[i * n + j] ?? 0;
      for (let k = 0; k < j; k += 1) sum -= (l[i * n + k] ?? 0) * (l[j * n + k] ?? 0);
      if (i === j) {
        if (!(sum > 0) || !Number.isFinite(sum)) return null;
        l[i * n + i] = Math.sqrt(sum);
      } else {
        l[i * n + j] = sum / (l[j * n + j] ?? 1);
      }
    }
  }
  return l;
}

/**
 * Diagonal of a⁻¹ for symmetric positive-definite `a`: the per-parameter
 * variances (up to the residual variance) of a least-squares fit. Null when
 * `a` is singular — some parameter is not determined by the data at all.
 */
export function inverseDiagonal(a: ArrayLike<number>, n: number): Float64Array | null {
  const l = choleskyFactor(a, n);
  if (l === null) return null;
  const out = new Float64Array(n);
  const unit = new Float64Array(n);
  for (let col = 0; col < n; col += 1) {
    unit.fill(0);
    unit[col] = 1;
    out[col] = solveWithFactor(l, unit, n)[col] ?? 0;
  }
  return out;
}
