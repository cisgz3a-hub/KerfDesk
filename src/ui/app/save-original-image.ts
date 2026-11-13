// Save Original Image (LightBurn export of an unprocessed image as PNG, JPEG
// or BMP). Saves the selected image's own pixels, before any operation's
// dither, adjustments or mask. When the source already has the chosen format
// its bytes are written unchanged; otherwise the browser decodes it and the
// pixels are re-encoded (BMP through core's encoder, which browsers lack).

import { encodeBmp24 } from '../../core/raster/encode-bmp';
import type { RasterImage } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { readRasterSourceFile } from '../import/paged-raster-source';
import { pickPreparedSaveTarget } from './pick-prepared-save-target';
import type { ToastVariant } from '../state/toast-store';
import { errorMessage } from '../../core/util/error-message';

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
  readonly encode?: (source: File, format: OriginalImageFormat, widthMm: number) => Promise<Blob>;
};

/**
 * Whether the stored pixels are no longer the imported file: Crop and Flatten
 * replace them with the baked crop (and leave an owned clip), and an Image
 * Studio Apply replaces them with the edit (and keeps its layer document).
 * Nothing else keeps the imported bytes (tools audit T1, T21-P2-2).
 */
export function imageEditedInProject(image: RasterImage): boolean {
  return image.imageClip !== undefined || image.editorDocument !== undefined;
}

/** The density a re-encoded file must carry to re-import at the image's
 * placed size: pixels across its width in millimetres (T21-P2-1). */
export function imageDpi(pixelWidth: number, widthMm: number): number | null {
  const dpi = pixelWidth / (widthMm / 25.4);
  return Number.isFinite(dpi) && dpi > 0 ? dpi : null;
}

export async function saveOriginalImage(ctx: SaveOriginalImageCtx): Promise<void> {
  const { mime, extension } = FORMATS[ctx.format];
  const edited = imageEditedInProject(ctx.image);
  try {
    // The picker empties an existing file as it returns (ADR-656): the image
    // is read and encoded first.
    const source = await (ctx.readSource ?? ((image) => readRasterSourceFile(image, image.source)))(
      ctx.image,
    );
    const widthMm = ctx.image.bounds.maxX - ctx.image.bounds.minX;
    const blob =
      source.type === mime
        ? source
        : await (ctx.encode ?? encodeInBrowser)(source, ctx.format, widthMm);
    // An edited image is not the imported file: never suggest its own name,
    // which would invite replacing the user's original (T21-P2-2).
    const stem = `${fileStem(ctx.image.source)}${edited ? '-edited' : ''}`;
    const target = await pickPreparedSaveTarget(
      ctx.platform,
      { suggestedName: `${stem}${extension}`, extensions: [extension] },
      { title: 'Save original image', message: 'The image is ready.' },
    );
    if (target === null) return;
    await target.write(blob);
    ctx.pushToast(
      `Saved the ${edited ? 'edited' : 'original'} image to ${target.displayName}`,
      'success',
    );
  } catch (error) {
    ctx.pushToast(`Could not save the image: ${errorMessage(error)}`, 'error');
  }
}

async function encodeInBrowser(
  source: File,
  format: OriginalImageFormat,
  widthMm: number,
): Promise<Blob> {
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
    // The image's own density, not the encoder's 96 DPI default: KerfDesk
    // reads BMP density on import, so 96 re-imported 2.6-3.1x too large.
    const dpi = imageDpi(pixels.width, widthMm) ?? undefined;
    return new Blob([encodeBmp24(pixels.data, pixels.width, pixels.height, dpi)], {
      type: 'image/bmp',
    });
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
