// Pixel helpers for light-solid recovery (ADR-393).

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
  const mean = new Float32Array(luma.length);
  const meanSquare = new Float32Array(luma.length);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    let sumSq = 0;
    for (let y = -radius; y <= radius; y += 1) {
      sum += rowMean[clamp(y, height) * width + x] as number;
      sumSq += rowSquare[clamp(y, height) * width + x] as number;
    }
    for (let y = 0; y < height; y += 1) {
      mean[y * width + x] = sum / window;
      meanSquare[y * width + x] = sumSq / window;
      const out = clamp(y - radius, height) * width + x;
      const into = clamp(y + radius + 1, height) * width + x;
      sum += (rowMean[into] as number) - (rowMean[out] as number);
      sumSq += (rowSquare[into] as number) - (rowSquare[out] as number);
    }
  }
  return { mean, meanSquare };
}

/** 1 on pixels within `reach` (Chebyshev) of THICK material: pixels farther
 *  than `halfWidth` from every light pixel. A band of non-light pixels up to
 *  about 2·halfWidth wide (an outline, a divider) has no thick pixels; a
 *  ground or a wide dark shape does. `queue` is scratch of image size. */
export function nearThickMaterial(
  light: Uint8Array,
  width: number,
  height: number,
  span: { readonly halfWidth: number; readonly reach: number },
  queue: Int32Array,
): Uint8Array {
  const FAR = 255;
  const distance = new Uint8Array(light.length).fill(FAR);
  let tail = 0;
  for (let i = 0; i < light.length; i += 1) {
    if (light[i] !== 1) continue;
    distance[i] = 0;
    queue[tail] = i;
    tail += 1;
  }
  spreadRings(distance, width, height, { queue, tail, rings: span.halfWidth, unreached: FAR });
  // Reuse the plane: thick pixels become the sources, everything else FAR.
  tail = 0;
  for (let i = 0; i < distance.length; i += 1) {
    if (distance[i] === FAR) {
      distance[i] = 0;
      queue[tail] = i;
      tail += 1;
    } else {
      distance[i] = FAR;
    }
  }
  spreadRings(distance, width, height, { queue, tail, rings: span.reach, unreached: FAR });
  for (let i = 0; i < distance.length; i += 1) distance[i] = distance[i] === FAR ? 0 : 1;
  return distance;
}

/** Breadth-first rings (8-connected) from the `tail` queued sources, writing
 *  each reached pixel's ring number into `distance`. */
function spreadRings(
  distance: Uint8Array,
  width: number,
  height: number,
  frontier: {
    readonly queue: Int32Array;
    tail: number;
    readonly rings: number;
    readonly unreached: number;
  },
): void {
  const { queue } = frontier;
  const around = new Int32Array(8);
  let head = 0;
  for (let ring = 1; ring <= frontier.rings && head < frontier.tail; ring += 1) {
    const end = frontier.tail;
    for (; head < end; head += 1) {
      neighbours8(around, queue[head] as number, width, height);
      for (const n of around) {
        if (n < 0 || distance[n] !== frontier.unreached) continue;
        distance[n] = ring;
        queue[frontier.tail] = n;
        frontier.tail += 1;
      }
    }
  }
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
