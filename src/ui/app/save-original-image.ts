// Save Original Image (LightBurn export of an unprocessed image as PNG, JPEG
// or BMP). Saves the selected image's own pixels, before any operation's
// dither, adjustments or mask. When the source already has the chosen format
// its bytes are written unchanged; otherwise the browser decodes it and the
// pixels are re-encoded (BMP through core's encoder, which browsers lack).

import { encodeBmp24 } from '../../core/raster/encode-bmp';
import type { RasterImage } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { readRasterSourceFile } from '../import/paged-raster-source';
import type { ToastVariant } from '../state/toast-store';

export type OriginalImageFormat = 'png' | 'jpeg' | 'bmp';

const FORMATS: Readonly<
  Record<OriginalImageFormat, { readonly mime: string; readonly extension: string }>
> = {
  png: { mime: 'image/png', extension: '.png' },
  jpeg: { mime: 'image/jpeg', extension: '.jpg' },
  bmp: { mime: 'image/bmp', extension: '.bmp' },
};

const JPEG_QUALITY = 0.95;

export type SaveOriginalImageCtx = {
  readonly platform: PlatformAdapter;
  readonly image: RasterImage;
  readonly format: OriginalImageFormat;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly readSource?: (image: RasterImage) => Promise<File>;
  readonly encode?: (source: File, format: OriginalImageFormat) => Promise<Blob>;
};

export async function saveOriginalImage(ctx: SaveOriginalImageCtx): Promise<void> {
  const { mime, extension } = FORMATS[ctx.format];
  let target;
  try {
    target = await ctx.platform.pickFileForSave({
      suggestedName: `${fileStem(ctx.image.source)}${extension}`,
      extensions: [extension],
    });
  } catch (error) {
    ctx.pushToast(`Could not save the image: ${message(error)}`, 'error');
    return;
  }
  if (target === null) return;
  try {
    const source = await (ctx.readSource ?? ((image) => readRasterSourceFile(image, image.source)))(
      ctx.image,
    );
    const blob =
      source.type === mime ? source : await (ctx.encode ?? encodeInBrowser)(source, ctx.format);
    await target.write(blob);
    ctx.pushToast(`Saved the original image to ${target.displayName}`, 'success');
  } catch (error) {
    ctx.pushToast(`Could not save the image: ${message(error)}`, 'error');
  }
}

async function encodeInBrowser(source: File, format: OriginalImageFormat): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const bitmap = await createImageBitmap(source);
  let context: CanvasRenderingContext2D;
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const drawingContext = canvas.getContext('2d');
    if (drawingContext === null)
      throw new Error('This browser cannot draw the image for re-encoding.');
    context = drawingContext;
    if (format === 'jpeg') {
      // eslint-disable-next-line no-restricted-syntax -- JPEG has no alpha: flatten onto white paper, image data not chrome.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0);
  } finally {
    // A failed canvas allocation/draw still owns the decoded bitmap.
    bitmap.close();
  }
  if (format === 'bmp') {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return new Blob([encodeBmp24(pixels.data, pixels.width, pixels.height)], { type: 'image/bmp' });
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob === null ? reject(new Error('The image could not be encoded.')) : resolve(blob),
      FORMATS[format].mime,
      JPEG_QUALITY,
    ),
  );
}

function fileStem(source: string): string {
  const name = (source.split(/[/\\]/u).pop() ?? source).replace(/\.[^.]*$/u, '');
  const safe = [...name]
    .map((char) => (/[<>:"/\\|?*]/u.test(char) || char < ' ' ? '-' : char))
    .join('');
  return safe.trim() === '' ? 'image' : safe.trim();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
