// Background flattening for automatic (Otsu) binarization under uneven
// lighting.
//
// A single global cut cannot separate ink from paper when the paper itself
// spans the ink/paper gap: a phone photo of a drawing, a vignetting scanner
// lid, or a sheet lit from one corner. On a 150→250 paper ramp Otsu splits
// the RAMP (cut ≈ 190) and the whole darker half of the sheet traces as one
// blob. Removing the slowly varying paper level first restores one cut.
//
// Published semantics this follows (no code or structure taken from any
// implementation, ADR-120/123): the high-pass background removal documented
// for bitmap preparation tools — subtract a heavily smoothed copy of the
// image, re-centre, then threshold — and the flat-field correction used for
// scanned documents (observed = reflectance × illumination, so divide by the
// illumination estimate). Separability η = σ²_between / σ²_total is the
// goodness measure from Otsu's paper (IEEE Trans. SMC 9(1), 1979).
//
// This design, in four steps:
//   1. Paper samples: split the frame into coarse cells and take a bright
//      percentile of each cell's luma. Strokes narrower than a cell cannot
//      move a bright percentile, so most cells report their paper level.
//   2. Paper surface: flood from the brightest cells through gradual steps
//      only, so cells behind a sharp ink edge start as ink. Fit the paper
//      cells with a Gaussian-weighted local PLANE (not a local mean, which
//      biases a ramp toward the interior at the frame edges). Cells well
//      below the fitted surface are ink-covered; they are excluded and the
//      fit is repeated, so a solid ink block is bridged from the paper
//      around it instead of being read as dark paper.
//   3. Gate: act only when the paper surface is credible (most cells are
//      paper and they lie on a smooth surface) and detectably non-uniform
//      (darkest paper below a fraction of the brightest). A uniform page
//      returns null and the caller keeps the exact historical global-Otsu
//      path, bit for bit.
//   4. Flat-field: luma × (brightest paper / local paper). The caller keeps
//      the flattened luma only if its histogram is credibly two-class (the
//      classes sit well apart) and flattening removes a clear share of the
//      histogram's within-class variance; otherwise it falls back to the
//      global cut. The flattened luma is also the sub-pixel crack field's
//      scalar, so edge positions interpolate on the same field that was
//      thresholded.
//
// Pure-core compliant: no clock, no random, no I/O.

import type { RawImageData } from './trace-image';
import type { TraceOptions } from './trace-option-types';
import { otsuSeparation } from './preprocess';

// Coarse grid: about this many cells along the long side, never smaller than
// MIN_CELL_PX so a cell always holds a meaningful percentile sample.
const TARGET_CELLS_LONG_SIDE = 48;
const MIN_CELL_PX = 4;
// A cell reports paper while less than ~85% of it is ink.
const PAPER_PERCENTILE = 0.85;
// Smoothing scale of the paper surface in cells (about 1/16 of the long side):
// broad enough to bridge solid ink blocks, narrow enough that a local plane
// follows a strong vignette's curvature to within a few luma.
const SURFACE_SIGMA_CELLS = 3;
// Ink-cell rejection: a cell is ink-covered when it sits below the fitted
// surface by more than max(MIN_REJECT_LUMA, REJECT_SIGMAS × robust σ).
const REJECT_PASSES = 3;
const MIN_REJECT_LUMA = 10;
const REJECT_SIGMAS = 3;
const MAD_TO_SIGMA = 1.4826;
// Credibility: the paper model needs paper in most cells, and those cells
// must actually lie on a smooth surface (lighting is smooth; a light-on-dark
// design or a busy picture is not). Otherwise there is no trustworthy paper
// level and the global cut is kept.
const MIN_PAPER_CELL_FRACTION = 0.5;
const MAX_PAPER_NOISE_LUMA = 8;
// Largest paper-level step between neighbouring cells that still reads as
// lighting (a strong vignette changes ≈ 9 luma per cell at its corners; a
// solid shape's edge jumps by its full contrast).
const MAX_PAPER_STEP_LUMA = 12;
// Non-uniformity: flatten only when the darkest paper is below this fraction
// of the brightest (≈ 20 levels on white paper). JPEG noise and paper grain
// stay far above it.
const MAX_UNIFORM_PAPER_RATIO = 0.92;
// Fallback: flattening must remove at least this share of the histogram's
// within-class variance (1 − η, Otsu's separability), or the global cut is
// kept. Relative, because on dense art the ink/paper split dominates η and
// lighting moves it by only a few hundredths even when it shifts the cut
// by 20+ luma.
const MIN_WITHIN_CLASS_REDUCTION = 0.1;
// Valley check: the flattened classes must also sit far apart. Without it an
// inkless uneven page (flattened to near-constant paper) could "separate"
// two rounding levels a few luma apart and trace paper grain as ink.
const MIN_FLATTENED_CONTRAST = 32;
// Grids smaller than this cannot express a lighting gradient.
const MIN_GRID_CELLS_PER_AXIS = 3;
const MAX_WIDENINGS = 4;
const MIN_FIT_WEIGHT = 1e-3;
const SINGULAR_FIT = 1e-9;

type CellGrid = {
  readonly cellPx: number;
  readonly cols: number;
  readonly rows: number;
};

type PaperSurface = {
  readonly grid: CellGrid;
  /** Fitted paper luma per cell. */
  readonly level: Float64Array;
  /** 1 where the cell's own sample was kept as paper. */
  readonly paper: Uint8Array;
  /** Robust sigma of the paper cells' samples around the fitted surface. */
  readonly noise: number;
};

export type OtsuBinarization = {
  /** The luma image to threshold AND to use as the sub-pixel crack field. */
  readonly source: RawImageData;
  readonly threshold: number;
  /** True when the background was flattened before thresholding. */
  readonly flattened: boolean;
};

/** The luma the preprocessing chain should threshold: flattened when the
 *  active cut is the automatic Otsu one (explicit Cutoff/Threshold values win,
 *  as in applyThresholdWithIso) and otsuBinarization adopts flattening; the
 *  input itself, ref-equal, otherwise. */
export function levelForAutomaticThreshold(
  image: RawImageData,
  options: Pick<TraceOptions, 'cutoffLuma' | 'thresholdLuma' | 'useOtsuThreshold'>,
): RawImageData {
  const automatic =
    options.useOtsuThreshold === true &&
    options.cutoffLuma === undefined &&
    options.thresholdLuma === undefined;
  return automatic ? otsuBinarization(image).source : image;
}

/** Automatic Otsu binarization with background flattening when — and only
 *  when — the paper is detectably uneven and flattening clearly improves the
 *  histogram's separability (see MIN_WITHIN_CLASS_REDUCTION). Otherwise
 *  `source` is the input, ref-equal, and `threshold` is exactly
 *  otsuThreshold(input). */
export function otsuBinarization(image: RawImageData): OtsuBinarization {
  const global = otsuSeparation(image);
  const flat = flattenUnevenBackground(image);
  if (flat !== null) {
    const local = otsuSeparation(flat);
    const credible = local.contrast >= MIN_FLATTENED_CONTRAST;
    const residual = (1 - local.separability) / Math.max(1e-9, 1 - global.separability);
    if (credible && residual <= 1 - MIN_WITHIN_CLASS_REDUCTION) {
      return { source: flat, threshold: local.threshold, flattened: true };
    }
  }
  return { source: image, threshold: global.threshold, flattened: false };
}

/** Flat-field the image against its estimated paper surface. Returns null
 *  when the paper is uniform or the paper model is not credible. The result
 *  is greyscale (R = G = B = flattened luma) with the source alpha. */
export function flattenUnevenBackground(image: RawImageData): RawImageData | null {
  const { width, height } = image;
  const grid = cellGrid(width, height);
  if (grid.cols < MIN_GRID_CELLS_PER_AXIS || grid.rows < MIN_GRID_CELLS_PER_AXIS) return null;
  const luma = lumaPlane(image);
  const surface = estimatePaperSurface(luma, width, height, grid);
  const range = paperRange(surface);
  if (range === null || range.min > range.max * MAX_UNIFORM_PAPER_RATIO) return null;
  return flatField(image, luma, surface, range.max);
}

function cellGrid(width: number, height: number): CellGrid {
  const cellPx = Math.max(MIN_CELL_PX, Math.ceil(Math.max(width, height) / TARGET_CELLS_LONG_SIDE));
  return { cellPx, cols: Math.ceil(width / cellPx), rows: Math.ceil(height / cellPx) };
}

function lumaPlane(image: RawImageData): Uint8Array {
  const out = new Uint8Array(image.width * image.height);
  for (let p = 0; p < out.length; p += 1) {
    const o = p * 4;
    out[p] = Math.round(
      0.299 * (image.data[o] ?? 0) +
        0.587 * (image.data[o + 1] ?? 0) +
        0.114 * (image.data[o + 2] ?? 0),
    );
  }
  return out;
}

function estimatePaperSurface(
  luma: Uint8Array,
  width: number,
  height: number,
  grid: CellGrid,
): PaperSurface {
  const samples = cellPaperSamples(luma, width, height, grid);
  const paper = bootstrapPaperCells(samples, grid);
  let level = fitSurface(samples, paper, grid);
  for (let pass = 0; pass < REJECT_PASSES; pass += 1) {
    if (!rejectInkCells(samples, level, paper)) break;
    level = fitSurface(samples, paper, grid);
  }
  return { grid, level, paper, noise: residualSigma(samples, level, paper) };
}

// First guess at which cells are paper, before any surface exists. Lighting
// changes gradually from cell to cell; the edge of solid ink is a sharp step.
// So paper is whatever the brightest cells reach through steps no larger than
// MAX_PAPER_STEP_LUMA between neighbouring cells. A solid shape of any size
// is cut off by its own edge (its interior is flat, so a smoothness test
// alone would mistake it for dark paper); thin strokes never darken a cell's
// bright percentile, so they do not block the flood. The fit/reject passes
// then refine the split.
function bootstrapPaperCells(samples: Float64Array, grid: CellGrid): Uint8Array {
  const paper = new Uint8Array(samples.length);
  let brightest = 0;
  for (const v of samples) brightest = Math.max(brightest, v);
  const queue: number[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    if ((samples[i] ?? 0) < brightest - MAX_PAPER_STEP_LUMA) continue;
    paper[i] = 1;
    queue.push(i);
  }
  while (queue.length > 0) {
    const cell = queue.pop() ?? 0;
    const col = cell % grid.cols;
    if (col > 0) floodPaper(samples, paper, queue, cell, cell - 1);
    if (col < grid.cols - 1) floodPaper(samples, paper, queue, cell, cell + 1);
    if (cell >= grid.cols) floodPaper(samples, paper, queue, cell, cell - grid.cols);
    if (cell + grid.cols < samples.length)
      floodPaper(samples, paper, queue, cell, cell + grid.cols);
  }
  return paper;
}

function floodPaper(
  samples: Float64Array,
  paper: Uint8Array,
  queue: number[],
  from: number,
  to: number,
): void {
  if (paper[to] === 1) return;
  if (Math.abs((samples[to] ?? 0) - (samples[from] ?? 0)) > MAX_PAPER_STEP_LUMA) return;
  paper[to] = 1;
  queue.push(to);
}

// Bright percentile of each cell's luma, via a reused 256-bin histogram.
function cellPaperSamples(
  luma: Uint8Array,
  width: number,
  height: number,
  grid: CellGrid,
): Float64Array {
  const out = new Float64Array(grid.cols * grid.rows);
  const hist = new Uint32Array(256);
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      hist.fill(0);
      const x0 = col * grid.cellPx;
      const y0 = row * grid.cellPx;
      const x1 = Math.min(width, x0 + grid.cellPx);
      const y1 = Math.min(height, y0 + grid.cellPx);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const v = luma[y * width + x] ?? 0;
          hist[v] = (hist[v] ?? 0) + 1;
        }
      }
      out[row * grid.cols + col] = histogramPercentile(hist, (x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

function histogramPercentile(hist: Uint32Array, count: number): number {
  const rank = Math.max(1, Math.ceil(PAPER_PERCENTILE * count));
  let seen = 0;
  for (let v = 0; v < 256; v += 1) {
    seen += hist[v] ?? 0;
    if (seen >= rank) return v;
  }
  return 255;
}

// Robust sigma of the paper cells' residuals from the fitted surface (scaled
// median absolute residual). Infinity when no paper cell remains.
function residualSigma(samples: Float64Array, level: Float64Array, paper: Uint8Array): number {
  const residuals: number[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    if (paper[i] === 1) residuals.push(Math.abs((samples[i] ?? 0) - (level[i] ?? 0)));
  }
  if (residuals.length === 0) return Infinity;
  residuals.sort((a, b) => a - b);
  return MAD_TO_SIGMA * (residuals[residuals.length >> 1] ?? 0);
}

// Re-splits cells against the fitted surface: a cell far below it is
// ink-covered, anything else is paper (so a cell wrongly excluded earlier is
// re-admitted). Returns whether any cell changed class. The tolerance is
// robust, floored so a perfectly smooth synthetic surface does not reject
// cells over rounding noise.
function rejectInkCells(samples: Float64Array, level: Float64Array, paper: Uint8Array): boolean {
  const sigma = residualSigma(samples, level, paper);
  if (!Number.isFinite(sigma)) return false;
  const tolerance = Math.max(MIN_REJECT_LUMA, REJECT_SIGMAS * sigma);
  let changed = false;
  for (let i = 0; i < samples.length; i += 1) {
    const next = (samples[i] ?? 0) < (level[i] ?? 0) - tolerance ? 0 : 1;
    if (next !== paper[i]) {
      paper[i] = next;
      changed = true;
    }
  }
  return changed;
}

function fitSurface(samples: Float64Array, paper: Uint8Array, grid: CellGrid): Float64Array {
  const out = new Float64Array(samples.length);
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      out[row * grid.cols + col] = fitCell(samples, paper, grid, col, row);
    }
  }
  return out;
}

// Gaussian-weighted least-squares plane through the paper cells around
// (col, row), evaluated at the cell itself. Widens the window when no paper
// lies within reach (deep inside a large ink block).
function fitCell(
  samples: Float64Array,
  paper: Uint8Array,
  grid: CellGrid,
  col: number,
  row: number,
): number {
  let sigma = SURFACE_SIGMA_CELLS;
  for (let attempt = 0; attempt <= MAX_WIDENINGS; attempt += 1) {
    const fitted = weightedPlaneAt(samples, paper, grid, col, row, sigma);
    if (fitted !== null) return Math.max(1, Math.min(255, fitted));
    sigma *= 2;
  }
  return samples[row * grid.cols + col] ?? 255;
}

function weightedPlaneAt(
  samples: Float64Array,
  paper: Uint8Array,
  grid: CellGrid,
  col: number,
  row: number,
  sigma: number,
): number | null {
  const m = planeMoments(samples, paper, grid, col, row, sigma);
  if (m.w < MIN_FIT_WEIGHT) return null;
  // Normal equations for v ≈ a + b·dx + c·dy in local offsets; `a` is the
  // value at the cell. Cramer's rule on the symmetric 3×3 system.
  const det =
    m.w * (m.xx * m.yy - m.xy * m.xy) -
    m.x * (m.x * m.yy - m.xy * m.y) +
    m.y * (m.x * m.xy - m.xx * m.y);
  if (Math.abs(det) <= SINGULAR_FIT * m.w * m.w * m.w) return m.v / m.w;
  const numerator =
    m.v * (m.xx * m.yy - m.xy * m.xy) -
    m.x * (m.xv * m.yy - m.xy * m.yv) +
    m.y * (m.xv * m.xy - m.xx * m.yv);
  return numerator / det;
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

function planeMoments(
  samples: Float64Array,
  paper: Uint8Array,
  grid: CellGrid,
  col: number,
  row: number,
  sigma: number,
): PlaneMoments {
  const m: PlaneMoments = { w: 0, x: 0, y: 0, xx: 0, xy: 0, yy: 0, v: 0, xv: 0, yv: 0 };
  const reach = Math.ceil(3 * sigma);
  const inv = 1 / (2 * sigma * sigma);
  const r0 = Math.max(0, row - reach);
  const r1 = Math.min(grid.rows - 1, row + reach);
  const c0 = Math.max(0, col - reach);
  const c1 = Math.min(grid.cols - 1, col + reach);
  for (let r = r0; r <= r1; r += 1) {
    const dy = r - row;
    for (let c = c0; c <= c1; c += 1) {
      const i = r * grid.cols + c;
      if (paper[i] !== 1) continue;
      const dx = c - col;
      const w = Math.exp(-(dx * dx + dy * dy) * inv);
      const v = samples[i] ?? 0;
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

function paperRange(surface: PaperSurface): { readonly min: number; readonly max: number } | null {
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < surface.level.length; i += 1) {
    if (surface.paper[i] !== 1) continue;
    const v = surface.level[i] ?? 0;
    count += 1;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (count < surface.level.length * MIN_PAPER_CELL_FRACTION) return null;
  if (surface.noise > MAX_PAPER_NOISE_LUMA) return null;
  return { min, max };
}

// luma × (reference paper / local paper), with the paper surface bilinearly
// interpolated between cell centres (clamped at the frame border).
function flatField(
  image: RawImageData,
  luma: Uint8Array,
  surface: PaperSurface,
  reference: number,
): RawImageData {
  const { width, height } = image;
  const { grid, level } = surface;
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < height; y += 1) {
    const gy = clampIndex((y + 0.5) / grid.cellPx - 0.5, grid.rows);
    const ry0 = Math.floor(gy);
    const ry1 = Math.min(grid.rows - 1, ry0 + 1);
    const fy = gy - ry0;
    for (let x = 0; x < width; x += 1) {
      const gx = clampIndex((x + 0.5) / grid.cellPx - 0.5, grid.cols);
      const cx0 = Math.floor(gx);
      const cx1 = Math.min(grid.cols - 1, cx0 + 1);
      const fx = gx - cx0;
      const top = lerp(
        level[ry0 * grid.cols + cx0] ?? 255,
        level[ry0 * grid.cols + cx1] ?? 255,
        fx,
      );
      const bottom = lerp(
        level[ry1 * grid.cols + cx0] ?? 255,
        level[ry1 * grid.cols + cx1] ?? 255,
        fx,
      );
      const paperLevel = Math.max(1, lerp(top, bottom, fy));
      const p = y * width + x;
      const v = Math.min(255, Math.round(((luma[p] ?? 0) * reference) / paperLevel));
      const o = p * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = image.data[o + 3] ?? 255;
    }
  }
  return { width, height, data };
}

function clampIndex(value: number, count: number): number {
  return Math.max(0, Math.min(count - 1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
