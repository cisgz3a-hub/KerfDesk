import type { Layer, RasterImage } from '../../core/scene';
import type { ToastVariant } from '../state/toast-store';
import type { ConvertToBitmapDialogOptions } from '../raster/ConvertToBitmapDialog';
import { buildBitmapFromVectors, type ConvertibleVector } from '../raster/vector-to-bitmap';

export async function convertSelectedVectorsToBitmap(
  convertibles: ReadonlyArray<ConvertibleVector>,
  layers: ReadonlyArray<Layer>,
  options: ConvertToBitmapDialogOptions,
  convertToBitmap: (sourceIds: ReadonlyArray<string>, raster: RasterImage) => void,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<void> {
  try {
    const raster = await buildBitmapFromVectors(convertibles, {
      ...options,
      layers: layers.map((layer) => ({ id: layer.id, color: layer.color, mode: layer.mode })),
    });
    convertToBitmap(
      convertibles.map((convertible) => convertible.id),
      raster,
    );
    pushToast(`Converted to bitmap: ${raster.source}`, 'success');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushToast(`Could not convert to bitmap: ${message}`, 'error');
  }
}
