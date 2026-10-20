// dither-rows — streamed (row-sequential) error diffusion. Every diffusion
// kernel in dither.ts reaches at most TWO rows ahead (dy <= 2), so the full
// Float32 image buffer the materialized path allocates is unnecessary: a
// rolling window of three width-sized rows reproduces dither() bit-for-bit
// while holding O(width) state. This is what lets arbitrarily large image
// engraves stream row-by-row instead of being refused for memory (ADR-243).
//
// The 'blue-noise' mode (dither-blue-noise.ts) reaches one row ahead and picks
// its weights from each pixel's original luma, so it runs in its own two-row
// window that also keeps those source rows.
//
// Access contract: forward-sequential access (y = 0, 1, 2, …) is O(width) per
// row. Requesting an earlier row than the last one produced resets the window
// and deterministically replays from row 0 — correct for any access pattern,
// but a strictly descending scan (the rotary row-reverse wrapper) degrades to
// O(height^2 * width). Every production consumer (emit, bounds, duration,
// toolpath) scans forward.
//
// Pure-core compliant: no clock, no random, no I/O; deterministic.

import {
  ERROR_DIFFUSION_QUANTIZE_LUMA,
  errorDiffusionKernel,
  type DiffusionKernel,
  type ErrorDiffusionMode,
} from './dither';
import { BLUE_NOISE_ROWS_AHEAD, diffuseBlueNoiseRow } from './dither-blue-noise';

const WHITE_LUMA = 255;
const WINDOW_ROWS = 3;

export type ErrorDiffusionRowInput = {
  readonly width: number;
  readonly height: number;
  readonly algorithm: ErrorDiffusionMode;
  // S emitted for a burn (black) pixel; matches DitherOptions.sMax.
  readonly sMax: number;
  // Deterministic luma source for a target row (already resampled, masked,
  // and machine-oriented). Called again on replay; must be pure in y.
  readonly lumaRowAt: (y: number) => Uint8Array;
};

/**
 * Stateful sequential row ditherer for the error-diffusion modes. The returned
 * function is a RasterGroup-compatible rowProvider: `(y) => Float64Array` whose
 * concatenation over y equals `dither()` on the same full-image luma.
 */
export function createErrorDiffusionRowDitherer(
  input: ErrorDiffusionRowInput,
): (y: number) => Float64Array {
  const state: RowWindow =
    input.algorithm === 'blue-noise'
      ? new BlueNoiseWindow(input)
      : new DiffusionWindow(input, errorDiffusionKernel(input.algorithm));
  let lastY = -1;
  let lastRow: Float64Array = new Float64Array(0);
  return (y: number): Float64Array => {
    if (!Number.isInteger(y) || y < 0 || y >= input.height) {
      throw new Error(`dither-rows: row ${y} outside 0..${input.height - 1}`);
    }
    if (y === lastY) return lastRow;
    if (y < state.nextY) state.reset();
    let row = lastRow;
    while (state.nextY <= y) row = state.advance();
    lastY = y;
    lastRow = row;
    return row;
  };
}

type RowWindow = {
  readonly nextY: number;
  reset(): void;
  advance(): Float64Array;
};

// The rolling three-row window: `current` is the row being quantized next
// (nextY); `ahead1` and `ahead2` accumulate the error diffused ahead of it.
class DiffusionWindow implements RowWindow {
  nextY = 0;
  private current: Float32Array;
  private ahead1: Float32Array;
  private ahead2: Float32Array;

  constructor(
    private readonly input: ErrorDiffusionRowInput,
    private readonly kernel: DiffusionKernel,
  ) {
    // The three-row window is only sound while no kernel reaches past dy=2.
    if (kernel.offsets.some(([, dy]) => dy > WINDOW_ROWS - 1)) {
      throw new Error('dither-rows: kernel reaches beyond the 3-row window');
    }
    this.current = new Float32Array(input.width);
    this.ahead1 = new Float32Array(input.width);
    this.ahead2 = new Float32Array(input.width);
    this.reset();
  }

  reset(): void {
    this.nextY = 0;
    this.loadLuma(this.current, 0);
    this.loadLuma(this.ahead1, 1);
    this.loadLuma(this.ahead2, 2);
  }

  advance(): Float64Array {
    const { width } = this.input;
    const y = this.nextY;
    const out = new Float64Array(width);
    // Serpentine scan identical to ditherErrorDiffusion: even rows sweep
    // left-to-right, odd rows right-to-left with the kernel's dx mirrored.
    const ltr = y % 2 === 0;
    const xStart = ltr ? 0 : width - 1;
    const xEnd = ltr ? width : -1;
    const xStep = ltr ? 1 : -1;
    for (let x = xStart; x !== xEnd; x += xStep) {
      const old = this.current[x] ?? 0;
      const quantized = old < ERROR_DIFFUSION_QUANTIZE_LUMA ? 0 : WHITE_LUMA;
      const err = old - quantized;
      out[x] = quantized === 0 ? this.input.sMax : 0;
      // Exact black/white pixels often carry no quantization error. Skipping
      // zero additions avoids a full kernel walk for blank image margins.
      // Test the accumulated error, not the source luma: nearby gray pixels
      // can still diffuse into an otherwise black or white pixel.
      if (err !== 0) this.diffuse(x, y, ltr, err);
    }
    this.rotate();
    this.nextY = y + 1;
    return out;
  }

  private diffuse(x: number, y: number, ltr: boolean, err: number): void {
    const { width, height } = this.input;
    for (const [dx0, dy, weight] of this.kernel.offsets) {
      const dx = ltr ? dx0 : -dx0;
      const xi = x + dx;
      if (xi < 0 || xi >= width || y + dy >= height) continue;
      const row = dy === 0 ? this.current : dy === 1 ? this.ahead1 : this.ahead2;
      row[xi] = (row[xi] ?? 0) + (err * weight) / this.kernel.divisor;
    }
  }

  private rotate(): void {
    const recycled = this.current;
    this.current = this.ahead1;
    this.ahead1 = this.ahead2;
    this.ahead2 = recycled;
    // The row entering the window (nextY + 3) starts as raw luma; diffusion
    // reaches it only once it is within two rows of the scan.
    this.loadLuma(recycled, this.nextY + WINDOW_ROWS);
  }

  private loadLuma(target: Float32Array, y: number): void {
    if (y >= this.input.height) {
      target.fill(0);
      return;
    }
    const luma = this.input.lumaRowAt(y);
    if (luma.length !== this.input.width) {
      throw new Error(`dither-rows: luma row ${y} has ${luma.length} values; expected width`);
    }
    for (let x = 0; x < this.input.width; x += 1) target[x] = luma[x] ?? WHITE_LUMA;
  }
}

// The blue-noise window: `current` is row nextY with its incoming error,
// `below` accumulates row nextY + 1, and each keeps a copy of its source luma
// (lumaRowAt may hand back a reused buffer).
class BlueNoiseWindow implements RowWindow {
  nextY = 0;
  private current: Float32Array;
  private below: Float32Array;
  private currentSource: Uint8Array;
  private belowSource: Uint8Array;

  constructor(private readonly input: ErrorDiffusionRowInput) {
    this.current = new Float32Array(input.width);
    this.below = new Float32Array(input.width);
    this.currentSource = new Uint8Array(input.width);
    this.belowSource = new Uint8Array(input.width);
    this.reset();
  }

  reset(): void {
    this.nextY = 0;
    this.load(this.current, this.currentSource, 0);
    this.load(this.below, this.belowSource, BLUE_NOISE_ROWS_AHEAD);
  }

  advance(): Float64Array {
    const y = this.nextY;
    const out = new Float64Array(this.input.width);
    const below = y + BLUE_NOISE_ROWS_AHEAD < this.input.height ? this.below : null;
    diffuseBlueNoiseRow(y, this.currentSource, this.current, below, out, this.input.sMax);
    [this.current, this.below] = [this.below, this.current];
    [this.currentSource, this.belowSource] = [this.belowSource, this.currentSource];
    this.load(this.below, this.belowSource, y + 1 + BLUE_NOISE_ROWS_AHEAD);
    this.nextY = y + 1;
    return out;
  }

  private load(target: Float32Array, source: Uint8Array, y: number): void {
    if (y >= this.input.height) {
      target.fill(0);
      source.fill(WHITE_LUMA);
      return;
    }
    const luma = this.input.lumaRowAt(y);
    if (luma.length !== this.input.width) {
      throw new Error(`dither-rows: luma row ${y} has ${luma.length} values; expected width`);
    }
    for (let x = 0; x < this.input.width; x += 1) {
      const value = luma[x] ?? WHITE_LUMA;
      source[x] = value;
      target[x] = value;
    }
  }
}
