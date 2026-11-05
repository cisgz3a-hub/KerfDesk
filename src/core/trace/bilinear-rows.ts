// Bilinear resampling of an RGBA buffer, a source row at a time (tracer speed
// round, 2026-11-05).
//
// Every output pixel is round(lerp(top, bottom, fy)), where top and bottom are
// lerp(left, right, fx) along two source rows. Those horizontal values depend
// only on the source row and the output column, and consecutive output rows
// read the same two source rows (a 2x enlargement reads each source row four
// times), so each source row is interpolated once into a reusable row buffer
// instead of once per output row. Every value is the same lerp of the same
// two bytes, in the same operation order, so the result keeps its bits.
//
// Pure core, deterministic.

/** Source pixels and weight per output sample along one axis: output sample o
 *  reads `low[o]` and `high[o]` with weight `weight[o]` on `high`. */
export type BilinearTaps = {
  readonly low: Int32Array;
  readonly high: Int32Array;
  readonly weight: Float64Array;
};

type Source = {
  readonly width: number;
  readonly data: Uint8ClampedArray;
};

/** The resampled RGBA bytes: output (x, y) is the bilinear blend of source
 *  rows `rows.low[y]` / `rows.high[y]` and columns `columns.low[x]` /
 *  `columns.high[x]`. Taps must be non-decreasing in y and index real rows. */
export function resampleBilinear(
  source: Source,
  columns: BilinearTaps,
  rows: BilinearTaps,
): Uint8ClampedArray {
  const width = columns.low.length;
  const height = rows.low.length;
  const data = new Uint8ClampedArray(width * height * 4);
  const rowValues = width * 4;
  let topRow = -1;
  let bottomRow = -1;
  let top = new Float64Array(rowValues);
  let bottom = new Float64Array(rowValues);
  for (let oy = 0; oy < height; oy += 1) {
    const row0 = rows.low[oy] as number;
    const row1 = rows.high[oy] as number;
    if (row0 !== topRow) {
      if (row0 === bottomRow) {
        const held = top;
        top = bottom;
        bottom = held;
        bottomRow = topRow;
      } else {
        interpolateRow(source, row0, columns, top);
      }
      topRow = row0;
    }
    const lower = row1 === topRow ? top : bottom;
    if (row1 !== topRow && row1 !== bottomRow) {
      interpolateRow(source, row1, columns, bottom);
      bottomRow = row1;
    }
    const fy = rows.weight[oy] as number;
    let dst = oy * rowValues;
    for (let k = 0; k < rowValues; k += 1) {
      const a = top[k] as number;
      data[dst] = Math.round(a + ((lower[k] as number) - a) * fy);
      dst += 1;
    }
  }
  return data;
}

// lerp(src[left + c], src[right + c], fx) for every output column of one row.
function interpolateRow(
  source: Source,
  row: number,
  columns: BilinearTaps,
  into: Float64Array,
): void {
  const src = source.data;
  const start = row * source.width * 4;
  const { low, high, weight } = columns;
  for (let ox = 0, o = 0; ox < low.length; ox += 1, o += 4) {
    const fx = weight[ox] as number;
    const l = start + (low[ox] as number) * 4;
    const r = start + (high[ox] as number) * 4;
    const l0 = src[l] as number;
    const l1 = src[l + 1] as number;
    const l2 = src[l + 2] as number;
    const l3 = src[l + 3] as number;
    into[o] = l0 + ((src[r] as number) - l0) * fx;
    into[o + 1] = l1 + ((src[r + 1] as number) - l1) * fx;
    into[o + 2] = l2 + ((src[r + 2] as number) - l2) * fx;
    into[o + 3] = l3 + ((src[r + 3] as number) - l3) * fx;
  }
}
