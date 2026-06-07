import type { Layer, RasterImage } from '../../core/scene';
import type { ToastVariant } from '../state/toast-store';
import type { ConvertToBitmapDialogOptions } from '../raster/ConvertToBitmapDialog';
import { buildBitmapFromVector, type ConvertibleVector } from '../raster/vector-to-bitmap';

export async function convertSelectedVectorToBitmap(
  convertible: ConvertibleVector,
  layers: ReadonlyArray<Layer>,
  options: ConvertToBitmapDialogOptions,
  convertToBitmap: (sourceId: string, raster: RasterImage) => void,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<void> {
  try {
    const raster = await buildBitmapFromVector(convertible, {
      ...options,
      layers: layers.map((layer) => ({ color: layer.color, mode: layer.mode })),
    });
    convertToBitmap(convertible.id, raster);
    pushToast(`Converted to bitmap: ${raster.source}`, 'success');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushToast(`Could not convert to bitmap: ${message}`, 'error');
  }
}

export function sourceLabel(o: ConvertibleVector): string {
  return 'source' in o ? o.source : o.content;
}
