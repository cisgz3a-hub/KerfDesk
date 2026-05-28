// Dithering for Phase F.2 raster engrave. Converts an 8-bit greyscale
// image (one luma byte per pixel, 0 = black = full burn, 255 = white =
// no burn) into a per-pixel power schedule that the raster emit path
// turns into S-values.
//
// Three modes per ADR-020 Q2:
//   - 'threshold'        single cut-off: pixel >= threshold → S=0, else S=Smax
//                        Cheapest, harshest. Good for clean line art.
//   - 'floyd-steinberg'  greyscale error-diffusion. Classic for laser
//                        photo-engraving. Serpentine scan to avoid
//                        directional artifacts on simple gradients.
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

export type DitherAlgorithm = 'threshold' | 'floyd-steinberg' | 'grayscale';

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
  // For 'threshold' only: pixel luma below this becomes a burn pixel.
  // Default 128 (middle grey). Ignored by other algorithms.
  readonly thresholdLuma?: number;
};

const DEFAULT_THRESHOLD = 128;

export function dither(input: DitherInput, options: DitherOptions): Uint16Array {
  switch (options.algorithm) {
    case 'threshold':
      return ditherThreshold(input, options);
    case 'grayscale':
      return ditherGrayscale(input, options);
    case 'floyd-steinberg':
      return ditherFloydSteinberg(input, options);
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
  for (let i = 0; i < input.luma.length; i += 1) {
    const l = input.luma[i] ?? TWO_FIFTY_FIVE;
    // (255 - l) / 255 maps black to 1.0, white to 0.0.
    out[i] = Math.round(((TWO_FIFTY_FIVE - l) / TWO_FIFTY_FIVE) * options.sMax);
  }
  return out;
}

// Floyd-Steinberg error diffusion (1976). The canonical photo-laser
// algorithm. We scan serpentine (alternate rows left-to-right and
// right-to-left) — straight raster scan produces visible diagonal
// banding on smooth gradients, the serpentine variant breaks the
// directionality. Error distribution table flips with direction.
//
// Algorithm:
//   For each pixel p with original luma L:
//     quantized Q = round(L) to nearest of {0, 255} (binary FS)
//     error E = L - Q
//     distribute E to neighbours per the FS table:
//             . p 7/16
//       3/16 5/16 1/16
//     (mirrored on right-to-left rows)
//   Emit Q's complement scaled to sMax.
//
// Pure: the input.luma buffer is NOT mutated; we copy into a working
// float buffer first so error diffusion writes don't change subsequent
// reads of the original.
function ditherFloydSteinberg(input: DitherInput, options: DitherOptions): Uint16Array {
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
      diffuseError(buf, width, height, x, y, ltr, err);
    }
  }
  return out;
}

// Spreads `err` onto the four FS neighbours of pixel (x, y) per the
// canonical 7/16, 3/16, 5/16, 1/16 weights. Mirrors left/right when
// scanning right-to-left (ltr=false) so the algorithm stays symmetric.
// Bound checks just skip edge pixels — no wrap-around.
function diffuseError(
  buf: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  ltr: boolean,
  err: number,
): void {
  const right = ltr ? x + 1 : x - 1;
  const left = ltr ? x - 1 : x + 1;
  const inRow = (xi: number): boolean => xi >= 0 && xi < width;
  if (inRow(right)) {
    buf[y * width + right] = (buf[y * width + right] ?? 0) + (err * 7) / 16;
  }
  if (y + 1 >= height) return;
  const nextRow = (y + 1) * width;
  if (inRow(left)) {
    buf[nextRow + left] = (buf[nextRow + left] ?? 0) + (err * 3) / 16;
  }
  buf[nextRow + x] = (buf[nextRow + x] ?? 0) + (err * 5) / 16;
  if (inRow(right)) {
    buf[nextRow + right] = (buf[nextRow + right] ?? 0) + err / 16;
  }
}
