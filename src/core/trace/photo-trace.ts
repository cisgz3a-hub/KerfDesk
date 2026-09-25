// A photograph's tone is represented by filled vector area, without a binary
// threshold or a colour palette. Vertical ribbons vary in width along their
// length; horizontal fill scanlines therefore retain even very light shades.
import { type ColoredPath } from '../scene';
import { finiteOr } from '../util';
import { photoToneLookup } from './photo-tone';
import { isValidRawImageData, type RawImageData, type TraceOptions } from './trace-image';
import type { TraceSteps } from './trace-steps';
import { photoRibbonsSteps, type PhotoGrid } from './photo-ribbons';

const DEFAULT_PHOTO_DETAIL = 60;
const MIN_BANDS = 48;
const MAX_BANDS = 320;
const SAMPLES_PER_BAND = 2;
const CHECKPOINT_PIXELS = 16384;

export function* traceImageToPhotoPathsSteps(
  image: RawImageData,
  options: TraceOptions,
): TraceSteps<ColoredPath[]> {
  yield;
  if (!isValidRawImageData(image)) return [];
  const grid = photoGrid(image, options.photoDetail);
  const darkness = yield* sampleDarknessSteps(image, grid, photoToneLookup(options));
  const polylines =
    (yield* photoRibbonsSteps(image, grid, darkness, true)) ??
    (yield* photoRibbonsSteps(image, grid, darkness, false)) ??
    [];
  return polylines.length === 0 ? [] : [{ color: '#000000', polylines }];
}

function photoGrid(image: RawImageData, requestedDetail: number | undefined): PhotoGrid {
  const detail = Math.max(0, Math.min(100, finiteOr(requestedDetail ?? DEFAULT_PHOTO_DETAIL, 60)));
  const longest = Math.max(image.width, image.height);
  // Detail spans what the image can hold: one band per pixel of the longest
  // side at most. A fixed 48..320 scale left the top of the slider identical
  // on small sources; sources of MAX_BANDS pixels or more keep that scale
  // exactly, because the capacity factor is then exactly 1.
  const capacity = Math.min(MAX_BANDS, longest) / MAX_BANDS;
  const bands = (MIN_BANDS + ((MAX_BANDS - MIN_BANDS) * detail) / 100) * capacity;
  return {
    columns: Math.max(1, Math.min(image.width, Math.round((image.width / longest) * bands))),
    rows: Math.max(
      1,
      Math.min(image.height, Math.round((image.height / longest) * bands * SAMPLES_PER_BAND)),
    ),
  };
}

// Exact source-pixel area integration, including fractional cells at both
// axes. Work is linear in source pixels and memory is bounded by 320 x 640
// doubles, independent of the source dimensions. Checkpoints also occur
// within wide source rows, so cooperative tracing remains interruptible.
function* sampleDarknessSteps(
  image: RawImageData,
  grid: PhotoGrid,
  tone: Float64Array,
): TraceSteps<Float64Array> {
  const cooperate = yield;
  const darkness = new Float64Array(grid.columns * grid.rows);
  let visited = 0;
  for (let y = 0; y < grid.rows; y += 1) {
    const top = (y * image.height) / grid.rows;
    const bottom = ((y + 1) * image.height) / grid.rows;
    for (let x = 0; x < grid.columns; x += 1) {
      const left = (x * image.width) / grid.columns;
      const right = ((x + 1) * image.width) / grid.columns;
      let total = 0;
      for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy += 1) {
        const height = Math.min(sy + 1, bottom) - Math.max(sy, top);
        for (let sx = Math.floor(left); sx < Math.ceil(right); sx += 1) {
          const width = Math.min(sx + 1, right) - Math.max(sx, left);
          const offset = (sy * image.width + sx) * 4;
          total += pixelDarkness(image, offset, tone) * width * height;
          visited += 1;
          if (cooperate && visited % CHECKPOINT_PIXELS === 0) yield;
        }
      }
      darkness[y * grid.columns + x] = Math.max(
        0,
        Math.min(1, total / ((right - left) * (bottom - top))),
      );
    }
  }
  return darkness;
}

function pixelDarkness(image: RawImageData, offset: number, tone: Float64Array): number {
  const { data } = image;
  const alpha = (data[offset + 3] ?? 0) / 255;
  if (alpha === 0) return 0;
  const composited = image.rgbCompositedOnWhite === true;
  const r = adjustedChannel(data[offset] ?? 0, alpha, composited, tone);
  const g = adjustedChannel(data[offset + 1] ?? 0, alpha, composited, tone);
  const b = adjustedChannel(data[offset + 2] ?? 0, alpha, composited, tone);
  // The lookup gives each channel's darkness in linear light, so Rec. 709
  // weights give one minus relative luminance. Compositing onto white in
  // linear light scales it by alpha, the covered area. Integer coefficients
  // keep neutral white at exactly zero and black at one.
  return ((r * 2126 + g * 7152 + b * 722) / 10000) * alpha;
}

function adjustedChannel(
  value: number,
  alpha: number,
  composited: boolean,
  tone: Float64Array,
): number {
  // Undo only the decoder's explicitly tagged white composite. Its byte
  // rounding can lose a small amount of source colour; alpha is applied once
  // after the tone adjustment, never again to already-composited darkness.
  const straight = composited
    ? Math.max(0, Math.min(255, Math.round(255 - (255 - value) / alpha)))
    : value;
  return tone[straight] ?? 0;
}
