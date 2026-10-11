import type { DecodedRaster } from '../raster-decode/decoded-raster';
import { inspectPsdComposite, type PsdComposite } from './psd-structure';

/** Decode only the stored flattened image, never layer pixels or effects. */
export async function decodePsdComposite(
  bytes: Uint8Array,
): Promise<DecodedRaster & { readonly hasColorProfile: boolean }> {
  const info = inspectPsdComposite(bytes);
  const { getCompositeImageData, initializeCanvas } = await import('ag-psd');
  // ag-psd's pixel decoder needs an allocation factory, not a DOM canvas.
  initializeCanvas(
    () => {
      throw new Error('PSD composite decoding must not request a canvas.');
    },
    (width, height) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      colorSpace: 'srgb',
    }),
  );
  const baseChannels = info.colorMode === 1 ? 1 : 3;
  const image = getCompositeImageData({
    width: info.width,
    height: info.height,
    channels: baseChannels,
    bitsPerChannel: 8,
    colorMode: info.colorMode,
    rawCompositeData: compositeChannels(bytes, info, 0, baseChannels),
  });
  if (image === undefined || !(image.data instanceof Uint8ClampedArray)) {
    throw new Error('PSD did not produce an 8-bit composite image.');
  }
  if (info.hasMergedAlpha) {
    const alpha = getCompositeImageData({
      width: info.width,
      height: info.height,
      channels: 1,
      bitsPerChannel: 8,
      colorMode: 1,
      rawCompositeData: compositeChannels(bytes, info, baseChannels, 1),
    });
    if (alpha === undefined) throw new Error('PSD merged alpha could not be decoded.');
    restoreMergedTransparency(image.data, alpha.data);
  }
  return {
    width: info.width,
    height: info.height,
    data: image.data,
    hasColorProfile: info.hasColorProfile,
    ...(info.dpi === null ? {} : { dpi: info.dpi }),
  };
}

// PSD merged RGB is composited against white. Recover straight colour before
// PNG encoding; applying alpha to the stored matte directly would whiten twice.
function restoreMergedTransparency(pixels: Uint8ClampedArray, alpha: ArrayLike<number>): void {
  for (let p = 0; p < pixels.length; p += 4) {
    const opacity = alpha[p] ?? 255;
    pixels[p + 3] = opacity;
    if (opacity === 0 || opacity === 255) continue;
    for (let c = 0; c < 3; c += 1) {
      pixels[p + c] = 255 - ((255 - (pixels[p + c] ?? 255)) * 255) / opacity;
    }
  }
}

// The public decoder expects only the selected channels' row table. Keeping
// auxiliary alpha separate also avoids treating a saved selection as opacity.
function compositeChannels(
  bytes: Uint8Array,
  info: PsdComposite,
  first: number,
  count: number,
): Uint8Array {
  const planePixels = info.width * info.height;
  let start = info.offset + 2;
  let end = start;
  let table: Uint8Array = new Uint8Array(0);
  if (info.compression === 0) {
    start += first * planePixels;
    end = start + count * planePixels;
  } else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tableStart = start;
    start += info.channels * info.height * 2;
    for (let row = 0; row < first * info.height; row += 1)
      start += view.getUint16(tableStart + row * 2);
    end = start;
    for (let row = first * info.height; row < (first + count) * info.height; row += 1)
      end += view.getUint16(tableStart + row * 2);
    table = bytes.subarray(
      tableStart + first * info.height * 2,
      tableStart + (first + count) * info.height * 2,
    );
  }
  const composite = new Uint8Array(2 + table.length + end - start);
  composite[1] = info.compression;
  composite.set(table, 2);
  composite.set(bytes.subarray(start, end), 2 + table.length);
  return composite;
}
