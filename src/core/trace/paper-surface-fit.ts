// Paper-surface fit for background flattening (background-flatten.ts,
// ADR-402): a robust, Gaussian-weighted local plane through the cells that
// are currently classed as paper, evaluated at every cell of the coarse grid.
// Own design (ADR-120/123): nothing here is taken from any implementation.
//
// Pure-core compliant: no clock, no random, no I/O.

export type CellGrid = {
  readonly cellPx: number;
  readonly cols: number;
  readonly rows: number;
};

// Smoothing scale of the paper surface in cells (about 1/16 of the long side):
// broad enough to bridge solid ink blocks, narrow enough that a local plane
// follows a strong vignette's curvature to within a few luma.
const SURFACE_SIGMA_CELLS = 3;
const MAX_WIDENINGS = 4;
const MIN_FIT_WEIGHT = 1e-3;
// Robust surface fit (see fitCell). The start is a LOW weighted quantile of
// the nearby paper samples: the percentile sample and the step-joined region
// already keep ink out, so what can still contaminate the region is brighter
// than the paper (a white margin joined to the sheet's lit end), and a low
// quantile keeps choosing the paper even where such a margin wraps a corner
// and covers most of the window. The band is wide enough for a ramp's own
// slope across the core of the window, and far narrower than the jump to a
// white margin or to ink.
const SURFACE_START_QUANTILE = 0.25;
const ROBUST_BAND_LUMA = 24;
const ROBUST_REFITS = 3;
const SINGULAR_FIT = 1e-9;

/** Fitted paper level for every cell, from the cells marked paper. */
export function fitSurface(samples: Float64Array, paper: Uint8Array, grid: CellGrid): Float64Array {
  const out = new Float64Array(samples.length);
  const context: FitContext = {
    samples,
    paper,
    grid,
    kernels: [],
    quantileBins: new Float64Array(256),
  };
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      out[row * grid.cols + col] = fitCell(context, col, row);
    }
  }
  return out;
}

type FitContext = {
  readonly samples: Float64Array;
  readonly paper: Uint8Array;
  readonly grid: CellGrid;
  /** Gaussian weights per widening attempt, (2·reach + 1)² row-major. */
  readonly kernels: Array<GaussianKernel | undefined>;
  /** Scratch 256-bin weight histogram for the weighted start quantile. */
  readonly quantileBins: Float64Array;
};

type GaussianKernel = { readonly reach: number; readonly weights: Float64Array };

type FitWindow = {
  readonly context: FitContext;
  readonly col: number;
  readonly row: number;
  readonly kernel: GaussianKernel;
};

/** v ≈ a + b·dx + c·dy in offsets from the cell; `a` is the value at the cell. */
type Plane = { readonly a: number; readonly b: number; readonly c: number };

// Robust Gaussian-weighted plane through the paper cells around (col, row),
// evaluated at the cell itself. Start from a low weighted quantile of the
// nearby paper samples (SURFACE_START_QUANTILE), then refit the plane from
// only the cells within ROBUST_BAND_LUMA of the current estimate. On a clean
// ramp every cell stays in the band and this is the plain least-squares
// plane. Where a brighter paper-like plateau joins the sheet (a white margin
// meeting its lit end) the fit follows the sheet, instead of a least-squares
// compromise that misfits both and lets the rejection passes peel the real
// paper away; the plateau's cells then sit far above the surface and are
// rejected. Widens the window when no paper lies within reach (deep inside a
// large ink block).
function fitCell(context: FitContext, col: number, row: number): number {
  let sigma = SURFACE_SIGMA_CELLS;
  for (let attempt = 0; attempt <= MAX_WIDENINGS; attempt += 1) {
    const kernel = (context.kernels[attempt] ??= gaussianKernel(sigma));
    const plane = robustPlaneAt({ context, col, row, kernel });
    if (plane !== null) return Math.max(1, Math.min(255, plane.a));
    sigma *= 2;
  }
  return context.samples[row * context.grid.cols + col] ?? 255;
}

function gaussianKernel(sigma: number): GaussianKernel {
  const reach = Math.ceil(3 * sigma);
  const span = 2 * reach + 1;
  const weights = new Float64Array(span * span);
  const inv = 1 / (2 * sigma * sigma);
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      weights[(dy + reach) * span + dx + reach] = Math.exp(-(dx * dx + dy * dy) * inv);
    }
  }
  return { reach, weights };
}

function robustPlaneAt(window: FitWindow): Plane | null {
  const start = weightedLowQuantileAt(window);
  if (start === null) return null;
  let plane: Plane = { a: start, b: 0, c: 0 };
  for (let refit = 0; refit < ROBUST_REFITS; refit += 1) {
    const next = weightedPlaneAt(window, plane);
    if (next === null) break;
    // The same inliers give the same plane: converged.
    const converged = next.a === plane.a && next.b === plane.b && next.c === plane.c;
    plane = next;
    if (converged) break;
  }
  return plane;
}

// Gaussian-weighted SURFACE_START_QUANTILE of the paper samples in reach, via
// a 256-bin weight histogram (samples are integer percentiles of 8-bit luma).
function weightedLowQuantileAt(window: FitWindow): number | null {
  const { context, col, row, kernel } = window;
  const { samples, paper, grid, quantileBins: bins } = context;
  const { reach, weights } = kernel;
  const span = 2 * reach + 1;
  bins.fill(0);
  let total = 0;
  const r1 = Math.min(grid.rows - 1, row + reach);
  const c1 = Math.min(grid.cols - 1, col + reach);
  for (let r = Math.max(0, row - reach); r <= r1; r += 1) {
    const kernelRow = (r - row + reach) * span + reach - col;
    for (let c = Math.max(0, col - reach); c <= c1; c += 1) {
      const i = r * grid.cols + c;
      if (paper[i] !== 1) continue;
      const w = weights[kernelRow + c] ?? 0;
      const bin = Math.max(0, Math.min(255, Math.round(samples[i] ?? 0)));
      bins[bin] = (bins[bin] ?? 0) + w;
      total += w;
    }
  }
  if (total < MIN_FIT_WEIGHT) return null;
  let seen = 0;
  for (let v = 0; v < 256; v += 1) {
    seen += bins[v] ?? 0;
    if (seen >= total * SURFACE_START_QUANTILE) return v;
  }
  return 255;
}

function weightedPlaneAt(window: FitWindow, guess: Plane): Plane | null {
  const m = planeMoments(window, guess);
  if (m.w < MIN_FIT_WEIGHT) return null;
  // Normal equations, Cramer's rule on the symmetric 3×3 system
  // [[w, x, y], [x, xx, xy], [y, xy, yy]] · (a, b, c) = (v, xv, yv).
  const det =
    m.w * (m.xx * m.yy - m.xy * m.xy) -
    m.x * (m.x * m.yy - m.xy * m.y) +
    m.y * (m.x * m.xy - m.xx * m.y);
  if (Math.abs(det) <= SINGULAR_FIT * m.w * m.w * m.w) return { a: m.v / m.w, b: 0, c: 0 };
  const a =
    m.v * (m.xx * m.yy - m.xy * m.xy) -
    m.x * (m.xv * m.yy - m.xy * m.yv) +
    m.y * (m.xv * m.xy - m.xx * m.yv);
  const b =
    m.w * (m.xv * m.yy - m.xy * m.yv) -
    m.v * (m.x * m.yy - m.xy * m.y) +
    m.y * (m.x * m.yv - m.xv * m.y);
  const c =
    m.w * (m.xx * m.yv - m.xv * m.xy) -
    m.x * (m.x * m.yv - m.xv * m.y) +
    m.v * (m.x * m.xy - m.xx * m.y);
  return { a: a / det, b: b / det, c: c / det };
}

type PlaneMoments = {
  w: number;
  x: number;
  y: number;
  xx: number;
  xy: number;
  yy: number;
  v: number;
  xv: number;
  yv: number;
};

// Weighted moments of the paper cells in reach that lie within
// ROBUST_BAND_LUMA of the guess.
function planeMoments(window: FitWindow, guess: Plane): PlaneMoments {
  const { context, col, row, kernel } = window;
  const { samples, paper, grid } = context;
  const { reach, weights } = kernel;
  const span = 2 * reach + 1;
  const m: PlaneMoments = { w: 0, x: 0, y: 0, xx: 0, xy: 0, yy: 0, v: 0, xv: 0, yv: 0 };
  const r1 = Math.min(grid.rows - 1, row + reach);
  const c1 = Math.min(grid.cols - 1, col + reach);
  for (let r = Math.max(0, row - reach); r <= r1; r += 1) {
    const dy = r - row;
    const kernelRow = (dy + reach) * span + reach;
    const rowGuess = guess.a + guess.c * dy;
    for (let c = Math.max(0, col - reach); c <= c1; c += 1) {
      const i = r * grid.cols + c;
      if (paper[i] !== 1) continue;
      const dx = c - col;
      const v = samples[i] ?? 0;
      if (Math.abs(v - (rowGuess + guess.b * dx)) > ROBUST_BAND_LUMA) continue;
      const w = weights[kernelRow + dx] ?? 0;
      m.w += w;
      m.x += w * dx;
      m.y += w * dy;
      m.xx += w * dx * dx;
      m.xy += w * dx * dy;
      m.yy += w * dy * dy;
      m.v += w * v;
      m.xv += w * dx * v;
      m.yv += w * dy * v;
    }
  }
  return m;
}
