import type { Layer, RasterImage } from '../../core/scene';
import type { ToastVariant } from '../state/toast-store';
import type { ConvertToBitmapDialogOptions } from '../raster/ConvertToBitmapDialog';
import { buildBitmapFromVectors, type ConvertibleVector } from '../raster/vector-to-bitmap';
import { useStore } from '../state';

export async function convertSelectedVectorsToBitmap(
  convertibles: ReadonlyArray<ConvertibleVector>,
  layers: ReadonlyArray<Layer>,
  options: ConvertToBitmapDialogOptions,
  convertToBitmap: (sourceIds: ReadonlyArray<string>, raster: RasterImage) => void,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<void> {
  const owner = {
    projectDocumentEpoch: useStore.getState().projectDocumentEpoch,
    sources: [...convertibles],
  };
  if (!conversionOwnerIsCurrent(owner)) return;
  try {
    const raster = await buildBitmapFromVectors(convertibles, {
      ...options,
      layers: layers.map((layer) => ({ id: layer.id, color: layer.color, mode: layer.mode })),
    });
    if (!conversionOwnerIsCurrent(owner)) return;
    convertToBitmap(
      convertibles.map((convertible) => convertible.id),
      raster,
    );
    pushToast(`Converted to bitmap: ${raster.source}`, 'success');
  } catch (err) {
    if (!conversionOwnerIsCurrent(owner)) return;
    const message = err instanceof Error ? err.message : String(err);
    pushToast(`Could not convert to bitmap: ${message}`, 'error');
  }
}

function conversionOwnerIsCurrent(owner: {
  readonly projectDocumentEpoch: number;
  readonly sources: ReadonlyArray<ConvertibleVector>;
}): boolean {
  const state = useStore.getState();
  if (state.projectDocumentEpoch !== owner.projectDocumentEpoch) return false;
  return owner.sources.every(
    (source) => state.project.scene.objects.find((object) => object.id === source.id) === source,
  );
}
