// Picture work for the overlay and the camera-moved check, done in the camera
// picture worker (ADR-440 Amendment 11, ADR-663 Amendment 6; rolling audit
// v14 Z1). On the UI thread a 4K picture's shrink took 118-243 ms, its pixels
// 76-251 ms and the moved check's thumbnail 47-119 ms, while a job ran.

import { compareViews } from '../../../core/camera/model/view-motion';
import { viewThumbnail, type ViewThumbnail } from '../../../core/camera/model/view-shift';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { shrinkWidth } from './picture-size';

/** A bridge picture for the overlay, decoded and shrunk to `resizeWidth`. */
export type DecodeRequest = {
  readonly op: 'decode';
  readonly blob: Blob;
  readonly resizeWidth: number;
};

/**
 * A held picture: its pixels when `pixels`, a copy for the overlay at most
 * `displayWidth` wide, and the moved check's thumbnail `thumbWidth` wide.
 */
export type StillRequest = {
  readonly op: 'still';
  readonly frame: ImageBitmap;
  readonly pixels: boolean;
  readonly displayWidth: number | null;
  readonly thumbWidth: number | null;
};

export type StillReply = {
  readonly kind: 'still';
  /** The picture's own size. */
  readonly width: number;
  readonly height: number;
  readonly image: RgbaImage | null;
  readonly display: ImageBitmap | null;
  readonly thumbnail: ViewThumbnail | null;
};

export type BitmapReply = { readonly kind: 'bitmap'; readonly bitmap: ImageBitmap };

/** The camera-moved check's comparison of two thumbnails (ADR-663 Amendment 6). */
export type CompareRequest = {
  readonly op: 'compare-views';
  readonly args: Parameters<typeof compareViews>[0];
};

export type CompareReply = {
  readonly kind: 'views';
  readonly comparison: ReturnType<typeof compareViews>;
};

export function compareWork(request: CompareRequest): CompareReply {
  return { kind: 'views', comparison: compareViews(request.args) };
}

export function decodeShrunk(request: DecodeRequest): Promise<ImageBitmap> {
  return createImageBitmap(request.blob, {
    resizeWidth: request.resizeWidth,
    resizeQuality: 'medium',
  });
}

export async function stillWork(
  request: StillRequest,
  readPixels: (frame: ImageBitmap) => RgbaImage | null,
): Promise<StillReply | null> {
  const { frame } = request;
  const needPixels = request.pixels || request.thumbWidth !== null;
  const pixels = needPixels ? readPixels(frame) : null;
  if (needPixels && pixels === null) return null;
  const thumbnail =
    request.thumbWidth === null || pixels === null
      ? null
      : viewThumbnail(pixels, request.thumbWidth);
  return {
    kind: 'still',
    width: frame.width,
    height: frame.height,
    image: request.pixels ? pixels : null,
    display: request.displayWidth === null ? null : await displayCopy(frame, request.displayWidth),
    thumbnail,
  };
}

function displayCopy(frame: ImageBitmap, displayWidth: number): Promise<ImageBitmap> {
  const resizeWidth = shrinkWidth(frame.width, displayWidth);
  return resizeWidth === undefined
    ? createImageBitmap(frame)
    : createImageBitmap(frame, { resizeWidth, resizeQuality: 'medium' });
}

/** What a reply hands back without a copy. */
export function stillTransfer(reply: StillReply): Transferable[] {
  const transfer: Transferable[] = [];
  if (reply.image !== null) transfer.push(reply.image.data.buffer as ArrayBuffer);
  if (reply.display !== null) transfer.push(reply.display);
  if (reply.thumbnail !== null) transfer.push(reply.thumbnail.data.buffer as ArrayBuffer);
  return transfer;
}
