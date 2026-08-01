// Perceptual test harness — a real photograph as an engrave-ready luma buffer.
//
// The raster fidelity fixtures are procedural: a ramp, a quadrant, a flat
// field. Those are the friendliest possible inputs to a density metric —
// smooth, low-frequency, and free of the fine detail where an error-diffusion
// dither actually has to work. A photograph is the adversarial case, so the
// thresholds in raster-burn-fidelity.test.ts only mean something once one has
// been through them.
//
// Two decisions worth stating:
//
//   - Luma is ITU-R BT.601 (0.299R + 0.587G + 0.114B), matching what the UI's
//     image import writes into RasterImage.lumaBase64 (core/scene/scene-object.ts).
//     A different weighting here would make the fixture disagree with the real
//     import path and quietly shift every score.
//
//   - Downsampling is a box (area-average) filter, not nearest-neighbour.
//     Nearest would alias a 1024×1024 photo into a 128×128 grid and inject
//     high-frequency noise the dither would then be blamed for. The box filter
//     is also what makes the source's local grey density — the quantity this
//     harness measures — survive the size reduction.
//
// Test-only helper: lives under src/__fixtures__ (boundary- and
// coverage-exempt per eslint.config.mjs). Pure apart from the file read.

import { decodePngFile } from './png-decode';

const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;
const RGBA_CHANNELS = 4;

export type PhotoLumaOptions = {
  readonly path: string;
  readonly width: number;
  readonly height: number;
};

type Span = { readonly first: number; readonly last: number };

/** Decode a PNG on disk and box-downsample it to a width×height luma grid. */
export function photoLuma(options: PhotoLumaOptions): Uint8Array {
  const image = decodePngFile(options.path);
  const out = new Uint8Array(options.width * options.height);
  for (let y = 0; y < options.height; y += 1) {
    const rows = sourceSpan(y, options.height, image.height);
    for (let x = 0; x < options.width; x += 1) {
      const cols = sourceSpan(x, options.width, image.width);
      out[y * options.width + x] = averageLuma(image, cols, rows);
    }
  }
  return out;
}

// Inclusive source range covered by one target cell, clamped so an upscale
// (target larger than source) still yields at least one pixel.
function sourceSpan(index: number, targetExtent: number, sourceExtent: number): Span {
  const first = Math.floor((index * sourceExtent) / targetExtent);
  const nextFirst = Math.floor(((index + 1) * sourceExtent) / targetExtent);
  return { first, last: Math.max(first, nextFirst - 1) };
}

function averageLuma(
  image: { readonly width: number; readonly data: Uint8ClampedArray },
  cols: Span,
  rows: Span,
): number {
  let sum = 0;
  let count = 0;
  for (let sy = rows.first; sy <= rows.last; sy += 1) {
    for (let sx = cols.first; sx <= cols.last; sx += 1) {
      const i = (sy * image.width + sx) * RGBA_CHANNELS;
      sum +=
        LUMA_R * (image.data[i] ?? 0) +
        LUMA_G * (image.data[i + 1] ?? 0) +
        LUMA_B * (image.data[i + 2] ?? 0);
      count += 1;
    }
  }
  return count === 0 ? 0 : Math.round(sum / count);
}
