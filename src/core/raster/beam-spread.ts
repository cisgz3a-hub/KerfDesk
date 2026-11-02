// Beam spread for the Photo engraving material view (ADR-685).
//
// A laser mark is the spot, not the scan cell: the 4040's 0.16 x 0.18 mm spot
// on a 0.1 mm interval (ADR-670) covers about 2.3 cells. Neighbouring dots
// overlap, so a dithered photo burns darker than its dot count. Each cell is
// split into `subdivisions` x `subdivisions` sub-cells. The kernel holds, for
// each sub-cell near a burned cell, the share of it one spot centred on that
// cell covers. Marks combine as a union: a sub-cell keeps the product of
// (1 - mark x share) over every spot that reaches it, and a cell shows the
// mean of its sub-cells. The product treats spots meeting inside one sub-cell
// as independent; finer sub-cells shrink that error, which the perceptual
// probe measures against exact supersampled discs. A Grayscale mark spreads
// in proportion to its power.
//
// This is a display model. It knows spot geometry, not how a material darkens
// (that is ADR-670's tone calibration), and never reaches compile or output.

export type BeamSpreadKernel = {
  readonly subdivisions: number;
  /** Sub-cell offsets from a cell's first sub-cell that its spot can reach. */
  readonly minX: number;
  readonly minY: number;
  readonly columns: number;
  readonly rows: number;
  /** Row-major rows x columns shares in 0..1. */
  readonly shares: Float64Array;
};

const SAMPLES = 24;
/** Spots wider than this many cells are drawn at this size, keeping the pass bounded. */
export const MAX_SPREAD_DIAMETER_CELLS = 7;
export const MAX_SPREAD_SUBDIVISIONS = 4;

/** The kernel for a spot `diameterX` x `diameterY` cells across, or null for no spread. */
export function beamSpreadKernel(
  diameterX: number,
  diameterY: number,
  subdivisions = 1,
): BeamSpreadKernel | null {
  if (!(diameterX > 0) || !(diameterY > 0)) return null;
  const s = Math.max(1, Math.min(MAX_SPREAD_SUBDIVISIONS, Math.floor(subdivisions)));
  const ax = (Math.min(MAX_SPREAD_DIAMETER_CELLS, diameterX) * s) / 2;
  const ay = (Math.min(MAX_SPREAD_DIAMETER_CELLS, diameterY) * s) / 2;
  const centre = s / 2;
  const minX = Math.floor(centre - ax);
  const minY = Math.floor(centre - ay);
  const columns = Math.ceil(centre + ax) - minX;
  const rows = Math.ceil(centre + ay) - minY;
  const shares = new Float64Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let inside = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        const y = minY + row + (sy + 0.5) / SAMPLES - centre;
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = minX + column + (sx + 0.5) / SAMPLES - centre;
          if ((x / ax) ** 2 + (y / ay) ** 2 <= 1) inside += 1;
        }
      }
      shares[row * columns + column] = inside / (SAMPLES * SAMPLES);
    }
  }
  return { subdivisions: s, minX, minY, columns, rows, shares };
}

/**
 * Spread compiled marks row by row. `sourceRow` is read once per row, in
 * order, so streamed raster groups work. `emit` receives each cell row, in
 * order, as darkness on the same 0..sMax scale as the marks.
 */
export function spreadRasterRows(
  width: number,
  height: number,
  sMax: number,
  kernel: BeamSpreadKernel,
  sourceRow: (y: number) => ArrayLike<number>,
  emit: (y: number, darkness: Float64Array) => void,
): void {
  const s = kernel.subdivisions;
  const pending = new Map<number, Float64Array>();
  let emitted = 0;
  const emitUpTo = (finalSubRows: number): void => {
    for (; emitted < height && (emitted + 1) * s <= finalSubRows; emitted += 1) {
      emit(emitted, cellRow(pending, emitted, width, s, sMax));
    }
  };
  for (let y = 0; y < height; y += 1) {
    const source = sourceRow(y);
    for (let x = 0; x < width; x += 1) {
      const mark = sMax > 0 ? Math.min(1, Math.max(0, (source[x] ?? 0) / sMax)) : 0;
      if (mark > 0) stampSpot(pending, kernel, x, y, mark, width, height);
    }
    // Later cells reach no higher than their own first sub-row plus minY.
    emitUpTo((y + 1) * s + kernel.minY);
  }
  emitUpTo(height * s);
}

function stampSpot(
  pending: Map<number, Float64Array>,
  kernel: BeamSpreadKernel,
  x: number,
  y: number,
  mark: number,
  width: number,
  height: number,
): void {
  const { subdivisions: s, minX, minY, columns, rows, shares } = kernel;
  const subWidth = width * s;
  for (let row = 0; row < rows; row += 1) {
    const ty = y * s + minY + row;
    if (ty < 0 || ty >= height * s) continue;
    let target = pending.get(ty);
    if (target === undefined) {
      target = new Float64Array(subWidth).fill(1);
      pending.set(ty, target);
    }
    const firstColumn = Math.max(0, -(x * s + minX));
    const lastColumn = Math.min(columns, subWidth - (x * s + minX));
    for (let column = firstColumn; column < lastColumn; column += 1) {
      const tx = x * s + minX + column;
      target[tx] = (target[tx] ?? 1) * (1 - mark * (shares[row * columns + column] ?? 0));
    }
  }
}

/** Reduce cell row `y`'s finished sub-rows to darkness per cell, releasing them. */
function cellRow(
  pending: Map<number, Float64Array>,
  y: number,
  width: number,
  s: number,
  sMax: number,
): Float64Array {
  const out = new Float64Array(width);
  for (let k = 0; k < s; k += 1) {
    const row = pending.get(y * s + k);
    pending.delete(y * s + k);
    if (row === undefined) continue;
    for (let i = 0; i < row.length; i += 1) {
      const x = Math.floor(i / s);
      out[x] = (out[x] ?? 0) + 1 - (row[i] ?? 1);
    }
  }
  const scale = sMax / (s * s);
  for (let x = 0; x < width; x += 1) out[x] = (out[x] ?? 0) * scale;
  return out;
}
