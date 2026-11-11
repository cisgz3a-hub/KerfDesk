// Camera picture work done away from the UI thread (ADR-490 Amendment 2,
// rolling audit v13 Y4-P1-1 / Y4-P2-1): reading a frame's pixels, flattening
// it onto the bed through the camera model, and encoding a JPEG. On the UI
// thread these held a running job's window for 60-300 ms a picture with a 4K
// camera or a calibrated whole-bed job, so an Abort pressed meanwhile waited.
// The overlay's pictures and the camera-moved check's are worked here too
// (ADR-440 Amendment 11, ADR-663 Amendment 6). Runs in
// camera-picture-worker.ts; needs OffscreenCanvas.

import type { CameraPose, LensModel } from '../../../core/camera/model/camera-model';
import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import { warpFrameToBedImage } from '../../../core/camera/model/bed-image';
import type { SurfaceHeightArea } from '../../../core/camera/model/height-areas';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import {
  compareWork,
  decodeShrunk,
  stillWork,
  type BitmapReply,
  type CompareReply,
  type CompareRequest,
  type DecodeRequest,
  type StillReply,
  type StillRequest,
} from './picture-work-still';

/** Where and how to flatten a frame onto the bed (the camera model fitted to its size). */
export type FlattenSpec = {
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly region: BedArea;
  readonly pixelsPerMm: number;
  readonly surfaceHeightMm: number;
  readonly heightAreas: ReadonlyArray<SurfaceHeightArea>;
};

export type PictureRequest =
  /** The flattened picture's pixels (the burn check compares them later). */
  | { readonly op: 'flat-image'; readonly frame: ImageBitmap; readonly flatten: FlattenSpec }
  /** A JPEG of the frame, flattened first when `flatten` is given, fitted to `maxSidePx`. */
  | {
      readonly op: 'jpeg';
      readonly frame: ImageBitmap;
      readonly flatten?: FlattenSpec;
      readonly maxSidePx: number;
      readonly quality: number;
    }
  | DecodeRequest
  | StillRequest
  | CompareRequest;

export type PictureReply =
  | { readonly kind: 'flat-image'; readonly image: RgbaImage }
  | { readonly kind: 'jpeg'; readonly blob: Blob; readonly width: number; readonly height: number }
  /** `unseen`: the camera does not see the region; `failed`: the frame could not be read or encoded. */
  | { readonly kind: 'unseen' }
  | { readonly kind: 'failed' }
  | BitmapReply
  | StillReply
  | CompareReply;

export async function doPictureWork(request: PictureRequest): Promise<PictureReply> {
  if (request.op === 'decode' || request.op === 'compare-views') {
    try {
      return request.op === 'decode'
        ? { kind: 'bitmap', bitmap: await decodeShrunk(request) }
        : compareWork(request);
    } catch {
      return { kind: 'failed' };
    }
  }
  try {
    if (request.op === 'still') return (await stillWork(request, bitmapPixels)) ?? FAILED;
    if (request.op === 'flat-image') {
      const image = flatten(request.frame, request.flatten);
      return image === null ? { kind: 'unseen' } : { kind: 'flat-image', image };
    }
    if (request.flatten !== undefined) {
      const image = flatten(request.frame, request.flatten);
      if (image === null) return { kind: 'unseen' };
      return await encodeRgba(image, request.maxSidePx, request.quality);
    }
    return await encodeBitmap(request.frame, request.maxSidePx, request.quality);
  } catch {
    return { kind: 'failed' };
  } finally {
    request.frame.close();
  }
}

const FAILED: PictureReply = { kind: 'failed' };

function flatten(frame: ImageBitmap, spec: FlattenSpec): RgbaImage | null {
  const pixels = bitmapPixels(frame);
  if (pixels === null) return null;
  return warpFrameToBedImage(pixels, spec.lens, spec.pose, {
    region: spec.region,
    pixelsPerMm: spec.pixelsPerMm,
    surfaceHeightMm: spec.surfaceHeightMm,
    heightAreas: spec.heightAreas,
  });
}

function bitmapPixels(frame: ImageBitmap): RgbaImage | null {
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  context.drawImage(frame, 0, 0);
  const image = context.getImageData(0, 0, frame.width, frame.height);
  return { data: image.data, width: image.width, height: image.height };
}

function fitted(width: number, height: number, maxSidePx: number) {
  const scale = Math.min(1, maxSidePx / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function encodeBitmap(
  frame: ImageBitmap,
  maxSidePx: number,
  quality: number,
): Promise<PictureReply> {
  const size = fitted(frame.width, frame.height, maxSidePx);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext('2d');
  if (context === null) return { kind: 'failed' };
  context.imageSmoothingQuality = 'high';
  context.drawImage(frame, 0, 0, size.width, size.height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { kind: 'jpeg', blob, ...size };
}

async function encodeRgba(
  image: RgbaImage,
  maxSidePx: number,
  quality: number,
): Promise<PictureReply> {
  const full = new OffscreenCanvas(image.width, image.height);
  const fullContext = full.getContext('2d');
  if (fullContext === null) return { kind: 'failed' };
  fullContext.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  const bitmap = full.transferToImageBitmap();
  try {
    return await encodeBitmap(bitmap, maxSidePx, quality);
  } finally {
    bitmap.close();
  }
}
