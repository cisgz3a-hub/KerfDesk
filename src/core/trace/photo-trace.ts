// A photograph's tone is represented by filled vector area, without a binary
// threshold or a colour palette. Vertical ribbons vary in width along their
// length; horizontal fill scanlines therefore retain even very light shades.
import {
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type Vec2,
} from '../scene';
import { finiteOr } from '../util';
import { adjustBrightness, adjustContrast, adjustGamma, invertImage } from './raster-prep';
import { isValidRawImageData, type RawImageData, type TraceOptions } from './trace-image';
import type { TraceSteps } from './trace-steps';

const DEFAULT_PHOTO_DETAIL = 60;
const MIN_BANDS = 48;
const MAX_BANDS = 320;
const SAMPLES_PER_BAND = 2;
const CHECKPOINT_PIXELS = 16384;

type PhotoGrid = { readonly columns: number; readonly rows: number };

export function* traceImageToPhotoPathsSteps(
  image: RawImageData,
  options: TraceOptions,
): TraceSteps<ColoredPath[]> {
  const cooperate = yield;
  if (!isValidRawImageData(image)) return [];
  const grid = photoGrid(image, options.photoDetail);
  const darkness = yield* sampleDarknessSteps(image, grid, photoToneLookup(options));
  const polylines: Polyline[] = [];
  const curves: CurveSubpath[] = [];
  for (let x = 0; x < grid.columns; x += 1) {
    let y = 0;
    while (y < grid.rows) {
      if ((darkness[y * grid.columns + x] ?? 0) === 0) {
        y += 1;
        continue;
      }
      const start = y;
      while (y < grid.rows && (darkness[y * grid.columns + x] ?? 0) > 0) y += 1;
      const ribbon = photoRibbon(image, grid, darkness, x, start, y);
      polylines.push(ribbon);
      curves.push(polylineToCurveSubpath(ribbon));
    }
    if (cooperate) yield;
  }
  return polylines.length === 0 ? [] : [{ color: '#000000', polylines, curves }];
}

function photoGrid(image: RawImageData, requestedDetail: number | undefined): PhotoGrid {
  const detail = Math.max(0, Math.min(100, finiteOr(requestedDetail ?? DEFAULT_PHOTO_DETAIL, 60)));
  const bands = MIN_BANDS + ((MAX_BANDS - MIN_BANDS) * detail) / 100;
  const longest = Math.max(image.width, image.height);
  return {
    columns: Math.max(1, Math.min(image.width, Math.round((image.width / longest) * bands))),
    rows: Math.max(
      1,
      Math.min(image.height, Math.round((image.height / longest) * bands * SAMPLES_PER_BAND)),
    ),
  };
}

// Reuse the normal trace adjustment maths on a 256-value ramp. Applying this
// LUT while sampling avoids allocating a full photo for every adjustment.
function photoToneLookup(options: TraceOptions): Uint8ClampedArray {
  const data = new Uint8ClampedArray(256 * 4);
  for (let value = 0; value < 256; value += 1) {
    data.fill(value, value * 4, value * 4 + 3);
    data[value * 4 + 3] = 255;
  }
  let ramp: RawImageData = { width: 256, height: 1, data };
  ramp = adjustBrightness(ramp, finiteOr(options.brightness ?? 0, 0));
  ramp = adjustContrast(ramp, finiteOr(options.contrast ?? 0, 0));
  ramp = adjustGamma(ramp, finiteOr(options.gamma ?? 1, 1));
  if (options.invert === true) ramp = invertImage(ramp);
  return ramp.data;
}

// Exact source-pixel area integration, including fractional cells at both
// axes. Work is linear in source pixels and memory is bounded by 320 x 640
// doubles, independent of the source dimensions. Checkpoints also occur
// within wide source rows, so cooperative tracing remains interruptible.
function* sampleDarknessSteps(
  image: RawImageData,
  grid: PhotoGrid,
  tone: Uint8ClampedArray,
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

function pixelDarkness(image: RawImageData, offset: number, tone: Uint8ClampedArray): number {
  const { data } = image;
  const alpha = (data[offset + 3] ?? 0) / 255;
  if (alpha === 0) return 0;
  const composited = image.rgbCompositedOnWhite === true;
  const r = adjustedChannel(data[offset] ?? 0, alpha, composited, tone);
  const g = adjustedChannel(data[offset + 1] ?? 0, alpha, composited, tone);
  const b = adjustedChannel(data[offset + 2] ?? 0, alpha, composited, tone);
  // Rec. 709 luminance in byte space, then composite onto white. Integer
  // coefficients keep neutral white at exactly zero and black at one.
  return (((255 - r) * 2126 + (255 - g) * 7152 + (255 - b) * 722) / 2550000) * alpha;
}

function adjustedChannel(
  value: number,
  alpha: number,
  composited: boolean,
  tone: Uint8ClampedArray,
): number {
  // Undo only the decoder's explicitly tagged white composite. Its byte
  // rounding can lose a small amount of source colour; alpha is applied once
  // after the tone adjustment, never again to already-composited darkness.
  const straight = composited
    ? Math.max(0, Math.min(255, Math.round(255 - (255 - value) / alpha)))
    : value;
  return tone[straight * 4] ?? 0;
}

function photoRibbon(
  image: RawImageData,
  grid: PhotoGrid,
  darkness: Float64Array,
  column: number,
  start: number,
  end: number,
): Polyline {
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const minX = (column * image.width) / grid.columns;
  const maxX = ((column + 1) * image.width) / grid.columns;
  const centerX = (minX + maxX) / 2;
  for (let boundary = start; boundary <= end; boundary += 1) {
    const before = darkness[Math.max(start, boundary - 1) * grid.columns + column] ?? 0;
    const after = darkness[Math.min(end - 1, boundary) * grid.columns + column] ?? 0;
    const halfWidth = ((before + after) * (maxX - minX)) / 4;
    const y = (boundary * image.height) / grid.rows;
    appendStraightened(left, { x: Math.max(minX, centerX - halfWidth), y });
    appendStraightened(right, { x: Math.min(maxX, centerX + halfWidth), y });
  }
  // Averaged internal boundary widths plus unchanged endpoint widths have
  // exactly the same integral as the sampled cells. White cells split runs
  // above, so interpolation never bridges a completely white gap.
  return { points: [...left, ...right.reverse()], closed: true };
}

function appendStraightened(points: Vec2[], point: Vec2): void {
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  if (a !== undefined && b !== undefined) {
    const cross = (b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x);
    if (Math.abs(cross) < 1e-12) {
      points[points.length - 1] = point;
      return;
    }
  }
  points.push(point);
}
