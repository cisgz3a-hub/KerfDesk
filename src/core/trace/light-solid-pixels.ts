// Pixel helpers for light-solid recovery (ADR-401).

/** Edge-clamped box means of luma and of luma² over a (2·radius+1)² window,
 *  in one separable pass pair (running sums, O(n) per axis). */
export function boxMoments(
  luma: Float32Array,
  width: number,
  height: number,
  radius: number,
): { readonly mean: Float32Array; readonly meanSquare: Float32Array } {
  const rowMean = new Float32Array(luma.length);
  const rowSquare = new Float32Array(luma.length);
  const window = 2 * radius + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    let sumSq = 0;
    for (let x = -radius; x <= radius; x += 1) {
      const v = luma[row + clamp(x, width)] as number;
      sum += v;
      sumSq += v * v;
    }
    for (let x = 0; x < width; x += 1) {
      rowMean[row + x] = sum / window;
      rowSquare[row + x] = sumSq / window;
      const out = luma[row + clamp(x - radius, width)] as number;
      const into = luma[row + clamp(x + radius + 1, width)] as number;
      sum += into - out;
      sumSq += into * into - out * out;
    }
  }
  // Column sums, advanced a row at a time: the additions of a pass down each
  // column, in the same order, reading memory along rows.
  const mean = new Float32Array(luma.length);
  const meanSquare = new Float32Array(luma.length);
  const sum = new Float64Array(width);
  const sumSq = new Float64Array(width);
  for (let y = -radius; y <= radius; y += 1) {
    const row = clamp(y, height) * width;
    for (let x = 0; x < width; x += 1) {
      sum[x] = (sum[x] as number) + (rowMean[row + x] as number);
      sumSq[x] = (sumSq[x] as number) + (rowSquare[row + x] as number);
    }
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const out = clamp(y - radius, height) * width;
    const into = clamp(y + radius + 1, height) * width;
    for (let x = 0; x < width; x += 1) {
      const s = sum[x] as number;
      const q = sumSq[x] as number;
      mean[row + x] = s / window;
      meanSquare[row + x] = q / window;
      sum[x] = s + ((rowMean[into + x] as number) - (rowMean[out + x] as number));
      sumSq[x] = q + ((rowSquare[into + x] as number) - (rowSquare[out + x] as number));
    }
  }
  return { mean, meanSquare };
}

/** 1 on pixels within `reach` (Chebyshev) of THICK material: pixels farther
 *  than `halfWidth` from every light pixel. A band of non-light pixels up to
 *  about 2·halfWidth wide (an outline, a divider) has no thick pixels; a
 *  ground or a wide dark shape does. */
export function nearThickMaterial(
  light: Uint8Array,
  width: number,
  height: number,
  span: { readonly halfWidth: number; readonly reach: number },
): Uint8Array {
  const thick = withinSquare(light, width, height, span.halfWidth);
  for (let i = 0; i < thick.length; i += 1) thick[i] = thick[i] === 1 ? 0 : 1;
  return withinSquare(thick, width, height, span.reach);
}

/** 1 on pixels with a set pixel of `mask` at most `radius` away along both
 *  axes (Chebyshev distance, which 8-connected rings from the set reach in
 *  as many steps): a count over a sliding window along each row, then over
 *  a sliding window of rows. */
function withinSquare(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const rows = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x < Math.min(radius, width); x += 1) count += mask[row + x] as number;
    for (let x = 0; x < width; x += 1) {
      if (x + radius < width) count += mask[row + x + radius] as number;
      if (x > radius) count -= mask[row + x - radius - 1] as number;
      rows[row + x] = count > 0 ? 1 : 0;
    }
  }
  return withinRows(rows, width, height, radius);
}

/** 1 on pixels with a set pixel of `rows` at most `radius` rows away in their column. */
function withinRows(rows: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const within = new Uint8Array(rows.length);
  const counts = new Int32Array(width);
  const addRow = (y: number, sign: number): void => {
    for (let x = 0; x < width; x += 1) {
      counts[x] = (counts[x] as number) + sign * (rows[y * width + x] as number);
    }
  };
  for (let y = 0; y < Math.min(radius, height); y += 1) addRow(y, 1);
  for (let y = 0; y < height; y += 1) {
    if (y + radius < height) addRow(y + radius, 1);
    if (y > radius) addRow(y - radius - 1, -1);
    for (let x = 0; x < width; x += 1) within[y * width + x] = (counts[x] as number) > 0 ? 1 : 0;
  }
  return within;
}

/** How many of the first `length` queued pixels have `values` below `level`. */
export function countBelow(
  values: Float32Array,
  queue: Int32Array,
  length: number,
  level: number,
): number {
  let count = 0;
  for (let k = 0; k < length; k += 1)
    if ((values[queue[k] as number] as number) < level) count += 1;
  return count;
}

function clamp(value: number, size: number): number {
  return value < 0 ? 0 : value >= size ? size - 1 : value;
}

/** Channel ÷ mean channel: independent of brightness, 1 for every grey. */
export function chromaticity(r: number, g: number, b: number): number[] {
  const mean = (r + g + b) / 3;
  return mean > 0 ? [r / mean, g / mean, b / mean] : [1, 1, 1];
}

export function chromaDistance(a: readonly number[], b: readonly number[]): number {
  return Math.max(
    Math.abs((a[0] as number) - (b[0] as number)),
    Math.abs((a[1] as number) - (b[1] as number)),
    Math.abs((a[2] as number) - (b[2] as number)),
  );
}

/** Add pixel i's RGB to sums[offset..offset+2]; transparent pixels are paper. */
export function addRgb(sums: number[], offset: number, rgba: Uint8ClampedArray, i: number): void {
  const o = 4 * i;
  const clear = rgba[o + 3] === 0;
  for (let c = 0; c < 3; c += 1) {
    sums[offset + c] = (sums[offset + c] as number) + (clear ? 255 : (rgba[o + c] as number));
  }
}

/** Fill `out` with the 4-neighbours of pixel `i` (−1 beyond the image);
 *  returns whether `i` lies on the image border. */
export function neighbours4(out: Int32Array, i: number, width: number, height: number): boolean {
  const x = i % width;
  out[0] = x > 0 ? i - 1 : -1;
  out[1] = x < width - 1 ? i + 1 : -1;
  out[2] = i >= width ? i - width : -1;
  out[3] = i < (height - 1) * width ? i + width : -1;
  return out[0] < 0 || out[1] < 0 || out[2] < 0 || out[3] < 0;
}

const DX8 = [-1, 1, 0, 0, -1, 1, -1, 1];
const DY8 = [0, 0, -1, 1, -1, -1, 1, 1];

/** Fill `out` with the 8-neighbours of pixel `i` (−1 beyond the image);
 *  returns whether `i` lies on the image border. */
export function neighbours8(out: Int32Array, i: number, width: number, height: number): boolean {
  const x = i % width;
  const y = (i - x) / width;
  for (let k = 0; k < 8; k += 1) {
    const dx = DX8[k] as number;
    const dy = DY8[k] as number;
    const inside = x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height;
    out[k] = inside ? i + dy * width + dx : -1;
  }
  return x === 0 || y === 0 || x === width - 1 || y === height - 1;
}
