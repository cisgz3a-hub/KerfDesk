/**
 * Dithering algorithms for converting grayscale images to
 * 1-bit patterns suitable for laser engraving.
 *
 * Input:  Uint8Array of grayscale pixels (0=black, 255=white)
 * Output: Uint8Array of 1-bit values (0=no burn, 255=burn)
 */

export type DitherMode = 'none' | 'threshold' | 'floyd-steinberg' | 'jarvis' | 'stucki' | 'ordered' | 'atkinson';

export function ditherImage(
  data: Uint8Array,
  width: number,
  height: number,
  mode: DitherMode,
  threshold: number = 128
): Uint8Array {
  switch (mode) {
    case 'none': return data.slice(); // Return copy unchanged
    case 'threshold': return ditherThreshold(data, width, height, threshold);
    case 'floyd-steinberg': return ditherErrorDiffusion(data, width, height, threshold, FLOYD_STEINBERG);
    case 'jarvis': return ditherErrorDiffusion(data, width, height, threshold, JARVIS);
    case 'stucki': return ditherErrorDiffusion(data, width, height, threshold, STUCKI);
    case 'atkinson': return ditherErrorDiffusion(data, width, height, threshold, ATKINSON);
    case 'ordered': return ditherOrdered(data, width, height);
    default: return data.slice();
  }
}

// ─── THRESHOLD ───────────────────────────────────────────────────

function ditherThreshold(
  data: Uint8Array, width: number, height: number, threshold: number
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] < threshold ? 255 : 0;
  }
  return out;
}

// ─── ERROR DIFFUSION ─────────────────────────────────────────────

interface DiffusionKernel {
  offsets: [number, number, number][]; // [dx, dy, weight]
  divisor: number;
}

const FLOYD_STEINBERG: DiffusionKernel = {
  offsets: [
    [1, 0, 7],
    [-1, 1, 3],
    [0, 1, 5],
    [1, 1, 1],
  ],
  divisor: 16,
};

const JARVIS: DiffusionKernel = {
  offsets: [
    [1, 0, 7], [2, 0, 5],
    [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
    [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1],
  ],
  divisor: 48,
};

const STUCKI: DiffusionKernel = {
  offsets: [
    [1, 0, 8], [2, 0, 4],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
    [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1],
  ],
  divisor: 42,
};

const ATKINSON: DiffusionKernel = {
  offsets: [
    [1, 0, 1], [2, 0, 1],
    [-1, 1, 1], [0, 1, 1], [1, 1, 1],
    [0, 2, 1],
  ],
  divisor: 8,
};

function ditherErrorDiffusion(
  data: Uint8Array,
  width: number,
  height: number,
  threshold: number,
  kernel: DiffusionKernel
): Uint8Array {
  // Work on float copy to accumulate error
  const buf = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) buf[i] = data[i];

  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const oldVal = buf[i];
      const newVal = oldVal < threshold ? 0 : 255;
      out[i] = newVal === 0 ? 255 : 0; // Invert: dark pixel = burn (255)
      const error = oldVal - newVal;

      // Distribute error to neighbors
      for (const [dx, dy, weight] of kernel.offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          buf[ny * width + nx] += (error * weight) / kernel.divisor;
        }
      }
    }
  }

  return out;
}

// ─── ORDERED (BAYER MATRIX) ──────────────────────────────────────

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function ditherOrdered(
  data: Uint8Array, width: number, height: number
): Uint8Array {
  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const bayerVal = BAYER_4X4[y % 4][x % 4];
      const thresh = ((bayerVal + 0.5) / 16) * 255;
      out[i] = data[i] < thresh ? 255 : 0; // dark = burn
    }
  }

  return out;
}
