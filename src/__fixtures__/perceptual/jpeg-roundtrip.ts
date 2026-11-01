// What a baseline JPEG encode and decode does to a greyscale picture, for
// tests: each 8 x 8 block's DCT is quantized with the example luminance table
// of ITU-T T.81 Annex K (Table K.1), scaled for `quality` as the IJG encoder
// scales it, then reconstructed. Entropy coding is lossless and greyscale has
// no chroma, so this is the whole loss. Edge blocks are padded by repeating
// the last row and column, as the encoder pads them. Real decoders use
// integer transforms, which move a few values by one level.

const BLOCK = 8;
const MAX_LEVEL = 255;
const LEVEL_SHIFT = 128;

// ITU-T T.81 Annex K, Table K.1, in row order.
const LUMINANCE_TABLE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

// The IJG quality scaling (quality 50 is the table itself), limited to the
// baseline range 1..255.
function quantizationTable(quality: number): number[] {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
  return LUMINANCE_TABLE.map((base) =>
    Math.min(MAX_LEVEL, Math.max(1, Math.floor((base * scale + 50) / 100))),
  );
}

// cos((2x + 1) u pi / 16) with the DCT's normalisation folded in.
const BASIS = Array.from({ length: BLOCK * BLOCK }, (_, i) => {
  const u = Math.floor(i / BLOCK);
  const x = i % BLOCK;
  const c = u === 0 ? Math.SQRT1_2 : 1;
  return (c / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * BLOCK));
});

function transformRows(input: Float64Array, inverse: boolean): Float64Array {
  const out = new Float64Array(BLOCK * BLOCK);
  for (let row = 0; row < BLOCK; row += 1) {
    for (let k = 0; k < BLOCK; k += 1) {
      let sum = 0;
      for (let j = 0; j < BLOCK; j += 1) {
        const weight = inverse
          ? (BASIS[j * BLOCK + k] as number)
          : (BASIS[k * BLOCK + j] as number);
        sum += weight * (input[row * BLOCK + j] as number);
      }
      out[row * BLOCK + k] = sum;
    }
  }
  return out;
}

function transpose(block: Float64Array): Float64Array {
  const out = new Float64Array(BLOCK * BLOCK);
  for (let y = 0; y < BLOCK; y += 1) {
    for (let x = 0; x < BLOCK; x += 1) out[x * BLOCK + y] = block[y * BLOCK + x] as number;
  }
  return out;
}

// Separable 2-D DCT-II (or its inverse) of one block.
function transform(block: Float64Array, inverse: boolean): Float64Array {
  return transpose(transformRows(transpose(transformRows(block, inverse)), inverse));
}

/** Row-major luma after a JPEG round trip at `quality` (1..100). */
export function jpegRoundTrip(
  luma: ArrayLike<number>,
  width: number,
  height: number,
  quality: number,
): Uint8ClampedArray {
  const table = quantizationTable(quality);
  const out = new Uint8ClampedArray(width * height);
  for (let by = 0; by < height; by += BLOCK) {
    for (let bx = 0; bx < width; bx += BLOCK) {
      const block = new Float64Array(BLOCK * BLOCK);
      for (let y = 0; y < BLOCK; y += 1) {
        for (let x = 0; x < BLOCK; x += 1) {
          const sx = Math.min(width - 1, bx + x);
          const sy = Math.min(height - 1, by + y);
          block[y * BLOCK + x] = (luma[sy * width + sx] as number) - LEVEL_SHIFT;
        }
      }
      const coefficients = transform(block, false);
      for (let i = 0; i < coefficients.length; i += 1) {
        const step = table[i] as number;
        coefficients[i] = Math.round((coefficients[i] as number) / step) * step;
      }
      const decoded = transform(coefficients, true);
      for (let y = 0; y < BLOCK && by + y < height; y += 1) {
        for (let x = 0; x < BLOCK && bx + x < width; x += 1) {
          out[(by + y) * width + bx + x] = Math.round(
            (decoded[y * BLOCK + x] as number) + LEVEL_SHIFT,
          );
        }
      }
    }
  }
  return out;
}
