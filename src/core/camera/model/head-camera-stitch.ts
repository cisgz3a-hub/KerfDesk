// One top-down picture of an area from a head camera's pictures (ADR-449).
// Each picture is flattened onto the bed through the model at the head
// position it was taken from, over the box the camera sees clearly there, and
// the pictures are blended where they overlap: each pixel is weighted by how
// far it is from its own picture's edge, so seams fade instead of stepping.
// Bed points no picture saw stay transparent. Pure core.

import type { RgbaImage } from '../rgba-image';
import { warpFrameToBedImage } from './bed-image';
import type { BedArea } from './camera-model-accuracy';
import type { Vec2 } from './camera-model';
import { lensForFrame, type CameraModelRecord } from './camera-model-record';
import { headCameraView, HEAD_CAMERA_USABLE_FRACTION, modelAtHead } from './head-camera';

export type HeadCameraPicture = {
  readonly frame: RgbaImage;
  /** The head's bed position (scene mm) when the picture was taken. */
  readonly headMm: Vec2;
};

export type StitchOptions = {
  /** The part of the bed pictured, mm; output pixel (0, 0) is its top-left corner. */
  readonly region: BedArea;
  readonly pixelsPerMm: number;
  readonly surfaceHeightMm: number;
  readonly usableFraction?: number;
};

// Across this share of a picture's clear box from its edge, a pixel's weight
// rises from almost nothing to full.
const FEATHER_FRACTION = 0.15;
const EDGE_WEIGHT = 0.02;

/** The stitched picture, or null when the region is empty or no picture fits the model. */
export function stitchHeadCameraPictures(
  record: CameraModelRecord,
  pictures: ReadonlyArray<HeadCameraPicture>,
  options: StitchOptions,
): RgbaImage | null {
  const width = Math.round(options.region.width * options.pixelsPerMm);
  const height = Math.round(options.region.height * options.pixelsPerMm);
  if (!(width > 0 && height > 0)) return null;
  const view = headCameraView(
    record,
    options.surfaceHeightMm,
    options.usableFraction ?? HEAD_CAMERA_USABLE_FRACTION,
  );
  if (view === null) return null;
  const sums = new Float32Array(width * height * 4);
  const weights = new Float32Array(width * height);
  let used = 0;
  for (const picture of pictures) {
    if (addPicture(record, picture, view, options, { width, height, sums, weights })) used += 1;
  }
  return used === 0 ? null : blended(width, height, sums, weights);
}

type Canvas = {
  readonly width: number;
  readonly height: number;
  readonly sums: Float32Array;
  readonly weights: Float32Array;
};

function addPicture(
  record: CameraModelRecord,
  picture: HeadCameraPicture,
  view: BedArea,
  options: StitchOptions,
  canvas: Canvas,
): boolean {
  const lens = lensForFrame(record, picture.frame.width, picture.frame.height);
  if (lens === null) return false;
  const clear: BedArea = { ...view, x: picture.headMm.x + view.x, y: picture.headMm.y + view.y };
  const box = pixelBox(clear, options.region, options.pixelsPerMm, canvas);
  if (box === null) return false;
  const ppm = options.pixelsPerMm;
  const warped = warpFrameToBedImage(
    picture.frame,
    lens,
    modelAtHead(record, picture.headMm).pose,
    {
      region: {
        x: options.region.x + box.x0 / ppm,
        y: options.region.y + box.y0 / ppm,
        width: (box.x1 - box.x0) / ppm,
        height: (box.y1 - box.y0) / ppm,
      },
      pixelsPerMm: ppm,
      surfaceHeightMm: options.surfaceHeightMm,
    },
  );
  if (warped === null) return false;
  const featherMm = Math.max(1e-6, FEATHER_FRACTION * Math.min(clear.width, clear.height));
  for (let y = 0; y < warped.height; y += 1) {
    const bedY = options.region.y + (box.y0 + y + 0.5) / ppm;
    const fromTop = Math.min(bedY - clear.y, clear.y + clear.height - bedY);
    for (let x = 0; x < warped.width; x += 1) {
      const source = (y * warped.width + x) * 4;
      const alpha = warped.data[source + 3] ?? 0;
      if (alpha === 0) continue;
      const bedX = options.region.x + (box.x0 + x + 0.5) / ppm;
      const fromSide = Math.min(bedX - clear.x, clear.x + clear.width - bedX, fromTop);
      const weight = Math.max(EDGE_WEIGHT, Math.min(1, fromSide / featherMm)) * (alpha / 255);
      const target = (box.y0 + y) * canvas.width + box.x0 + x;
      canvas.weights[target] = (canvas.weights[target] ?? 0) + weight;
      for (let c = 0; c < 3; c += 1) {
        const index = target * 4 + c;
        canvas.sums[index] = (canvas.sums[index] ?? 0) + weight * (warped.data[source + c] ?? 0);
      }
    }
  }
  return true;
}

type PixelBox = {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
};

// The output pixels (x0..x1, y0..y1 exclusive) inside both the clear box and the region.
function pixelBox(
  clear: BedArea,
  region: BedArea,
  pixelsPerMm: number,
  canvas: Pick<Canvas, 'width' | 'height'>,
): PixelBox | null {
  const x0 = Math.max(0, Math.ceil((clear.x - region.x) * pixelsPerMm));
  const y0 = Math.max(0, Math.ceil((clear.y - region.y) * pixelsPerMm));
  const x1 = Math.min(canvas.width, Math.floor((clear.x + clear.width - region.x) * pixelsPerMm));
  const y1 = Math.min(canvas.height, Math.floor((clear.y + clear.height - region.y) * pixelsPerMm));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

function blended(
  width: number,
  height: number,
  sums: Float32Array,
  weights: Float32Array,
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const weight = weights[i] ?? 0;
    if (weight <= 0) continue;
    for (let c = 0; c < 3; c += 1) data[i * 4 + c] = (sums[i * 4 + c] ?? 0) / weight;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}
