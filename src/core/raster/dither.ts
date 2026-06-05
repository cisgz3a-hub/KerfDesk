// Dithering for Phase F.2 raster engrave. Converts an 8-bit greyscale
// image (one luma byte per pixel, 0 = black = full burn, 255 = white =
// no burn) into a per-pixel power schedule that the raster emit path
// turns into S-values.
//
// Raster modes per ADR-020 Q2 plus the LightBurn-parity audit:
//   - 'threshold'        single cut-off: pixel >= threshold → S=0, else S=Smax
//                        Cheapest, harshest. Good for clean line art.
//   - 'floyd-steinberg'  greyscale error-diffusion. Classic for laser
//                        photo-engraving. Serpentine scan to avoid
//                        directional artifacts on simple gradients.
//   - 'jarvis' / 'stucki' / 'atkinson' / 'burkes' / 'sierra*'
//                        alternate error-diffusion kernels exposed by
//                        LightBurn-style image workflows.
//   - 'ordered'          Bayer ordered dither, deterministic and crisp.
//   - 'grayscale'        direct luma → S, no dithering. For lasers that
//                        actually accept analogue S values; produces
//                        smooth gradients but most diode lasers don't
//                        respond linearly to S.
//
// All three return Uint16Array (length = width*height) of S values
// already scaled to [0, sMax]. Uint16 because typical GRBL `$30` is
// 1000 (or 255, or higher per controller) and Uint8 wraps modulo 256;
// Uint16 holds the full 0..65535 range any GRBL fork might use. The
// raster emit path consumes these directly — power-scale invariant
// is already applied here.
//
// Pure-core compliant: no clock, no random, no I/O. Algorithms are
// deterministic — same input, same output, always.

const TWO_FIFTY_FIVE = 255;

export type DitherAlgorithm =
  | 'threshold'
  | 'floyd-steinberg'
  | 'jarvis'
  | 'stucki'
  | 'atkinson'
  | 'burkes'
  | 'sierra3'
  | 'sierra2'
  | 'sierra-lite'
  | 'ordered'
  | 'grayscale';

export type DitherInput = {
  // Greyscale pixels, row-major, length = width * height.
  // 0 = black (full power); 255 = white (laser off).
  readonly luma: Uint8Array;
  readonly width: number;
  readonly height: number;
};

export type DitherOptions = {
  readonly algorithm: DitherAlgorithm;
  // The S-value emitted for a full-power burn pixel. Engraving rarely
  // wants 100% — typical photo work uses 60-80% to avoid charring.
  // Caller decides; this module just outputs values in [0, sMax].
  readonly sMax: number;
  readonly sMin?: number;
  // For 'threshold' only: pixel luma below this becomes a burn pixel.
  // Default 128 (middle grey). Ignored by other algorithms.
  readonly thresholdLuma?: number;
};

const DEFAULT_THRESHOLD = 128;

export function dither(input: DitherInput, options: DitherOptions): Uint16Array {
  if (isErrorDiffusionMode(options.algorithm)) {
    return ditherErrorDiffusion(input, options, kernelFor(options.algorithm));
  }
  switch (options.algorithm) {
    case 'threshold':
      return ditherThreshold(input, options);
    case 'ordered':
      return ditherOrdered(input, options);
    case 'grayscale':
      return ditherGrayscale(input, options);
  }
}

type ErrorDiffusionMode =
  | 'floyd-steinberg'
  | 'jarvis'
  | 'stucki'
  | 'atkinson'
  | 'burkes'
  | 'sierra3'
  | 'sierra2'
  | 'sierra-lite';

type DiffusionKernel = {
  readonly offsets: ReadonlyArray<readonly [number, number, number]>;
  readonly divisor: number;
};

function isErrorDiffusionMode(mode: DitherAlgorithm): mode is ErrorDiffusionMode {
  return (
    mode === 'floyd-steinberg' ||
    mode === 'jarvis' ||
    mode === 'stucki' ||
    mode === 'atkinson' ||
    mode === 'burkes' ||
    mode === 'sierra3' ||
    mode === 'sierra2' ||
    mode === 'sierra-lite'
  );
}

function kernelFor(mode: ErrorDiffusionMode): DiffusionKernel {
  switch (mode) {
    case 'floyd-steinberg':
      return FLOYD_STEINBERG;
    case 'jarvis':
      return JARVIS;
    case 'stucki':
      return STUCKI;
    case 'atkinson':
      return ATKINSON;
    case 'burkes':
      return BURKES;
    case 'sierra3':
      return SIERRA3;
    case 'sierra2':
      return SIERRA2;
    case 'sierra-lite':
      return SIERRA_LITE;
  }
}

// Single-cutoff: harsh black/white split. ~5 LOC of real work.
function ditherThreshold(input: DitherInput, options: DitherOptions): Uint16Array {
  const out = new Uint16Array(input.luma.length);
  const cutoff = options.thresholdLuma ?? DEFAULT_THRESHOLD;
  for (let i = 0; i < input.luma.length; i += 1) {
    const l = input.luma[i] ?? TWO_FIFTY_FIVE;
    out[i] = l < cutoff ? options.sMax : 0;
  }
  return out;
}

// Direct luma → S mapping. Linear interpolation: black (0) maps to
// sMax, white (255) maps to 0. For lasers that can actually modulate
// power smoothly via S — diode lasers vary; the operator decides
// whether to use this or floyd-steinberg.
function ditherGrayscale(input: DitherInput, options: DitherOptions): Uint16Array {
  const out = new Uint16Array(input.luma.length);
  const sMax = normalizeS(options.sMax);
  const sMin = Math.min(sMax, normalizeS(options.sMin ?? 0));
  for (let i = 0; i < input.luma.length; i += 1) {
    const l = input.luma[i] ?? TWO_FIFTY_FIVE;
    // (255 - l) / 255 maps black to 1.0, white to 0.0.
    const strength = (TWO_FIFTY_FIVE - l) / TWO_FIFTY_FIVE;
    out[i] = strength <= 0 ? 0 : Math.round(sMin + strength * (sMax - sMin));
  }
  return out;
}

function normalizeS(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

function ditherOrdered(input: DitherInput, options: DitherOptions): Uint16Array {
  const out = new Uint16Array(input.luma.length);
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const i = y * input.width + x;
      const l = input.luma[i] ?? TWO_FIFTY_FIVE;
      const threshold = BAYER_4X4[y % 4]?.[x % 4] ?? DEFAULT_THRESHOLD;
      out[i] = l < threshold ? options.sMax : 0;
    }
  }
  return out;
}

function ditherErrorDiffusion(
  input: DitherInput,
  options: DitherOptions,
  kernel: DiffusionKernel,
): Uint16Array {
  const { width, height } = input;
  const buf = new Float32Array(input.luma.length);
  for (let i = 0; i < input.luma.length; i += 1) {
    buf[i] = input.luma[i] ?? TWO_FIFTY_FIVE;
  }
  const out = new Uint16Array(input.luma.length);
  for (let y = 0; y < height; y += 1) {
    const ltr = y % 2 === 0;
    const xStart = ltr ? 0 : width - 1;
    const xEnd = ltr ? width : -1;
    const xStep = ltr ? 1 : -1;
    for (let x = xStart; x !== xEnd; x += xStep) {
      const i = y * width + x;
      const old = buf[i] ?? 0;
      const quantized = old < DEFAULT_THRESHOLD ? 0 : TWO_FIFTY_FIVE;
      const err = old - quantized;
      out[i] = quantized === 0 ? options.sMax : 0;
      diffuseError(buf, width, height, x, y, ltr, err, kernel);
    }
  }
  return out;
}

function diffuseError(
  buf: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  ltr: boolean,
  err: number,
  kernel: DiffusionKernel,
): void {
  for (const [dx0, dy, weight] of kernel.offsets) {
    const dx = ltr ? dx0 : -dx0;
    const xi = x + dx;
    const yi = y + dy;
    if (xi < 0 || xi >= width || yi < 0 || yi >= height) continue;
    const i = yi * width + xi;
    buf[i] = (buf[i] ?? 0) + (err * weight) / kernel.divisor;
  }
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
    [1, 0, 7],
    [2, 0, 5],
    [-2, 1, 3],
    [-1, 1, 5],
    [0, 1, 7],
    [1, 1, 5],
    [2, 1, 3],
    [-2, 2, 1],
    [-1, 2, 3],
    [0, 2, 5],
    [1, 2, 3],
    [2, 2, 1],
  ],
  divisor: 48,
};

const STUCKI: DiffusionKernel = {
  offsets: [
    [1, 0, 8],
    [2, 0, 4],
    [-2, 1, 2],
    [-1, 1, 4],
    [0, 1, 8],
    [1, 1, 4],
    [2, 1, 2],
    [-2, 2, 1],
    [-1, 2, 2],
    [0, 2, 4],
    [1, 2, 2],
    [2, 2, 1],
  ],
  divisor: 42,
};

const ATKINSON: DiffusionKernel = {
  offsets: [
    [1, 0, 1],
    [2, 0, 1],
    [-1, 1, 1],
    [0, 1, 1],
    [1, 1, 1],
    [0, 2, 1],
  ],
  divisor: 8,
};

const BURKES: DiffusionKernel = {
  offsets: [
    [1, 0, 8],
    [2, 0, 4],
    [-2, 1, 2],
    [-1, 1, 4],
    [0, 1, 8],
    [1, 1, 4],
    [2, 1, 2],
  ],
  divisor: 32,
};

const SIERRA3: DiffusionKernel = {
  offsets: [
    [1, 0, 5],
    [2, 0, 3],
    [-2, 1, 2],
    [-1, 1, 4],
    [0, 1, 5],
    [1, 1, 4],
    [2, 1, 2],
    [-1, 2, 2],
    [0, 2, 3],
    [1, 2, 2],
  ],
  divisor: 32,
};

const SIERRA2: DiffusionKernel = {
  offsets: [
    [1, 0, 4],
    [2, 0, 3],
    [-2, 1, 1],
    [-1, 1, 2],
    [0, 1, 3],
    [1, 1, 2],
    [2, 1, 1],
  ],
  divisor: 16,
};

const SIERRA_LITE: DiffusionKernel = {
  offsets: [
    [1, 0, 2],
    [-1, 1, 1],
    [0, 1, 1],
  ],
  divisor: 4,
};

const BAYER_4X4: ReadonlyArray<ReadonlyArray<number>> = [
  [8, 136, 40, 168],
  [200, 72, 232, 104],
  [56, 184, 24, 152],
  [248, 120, 216, 88],
];
