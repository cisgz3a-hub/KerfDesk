import type { Layer, RasterImage } from '../../core/scene';
import type { ToastVariant } from '../state/toast-store';
import type { ConvertToBitmapDialogOptions } from '../raster/ConvertToBitmapDialog';
import { buildBitmapFromVectors, type ConvertibleVector } from '../raster/vector-to-bitmap';
import { useStore } from '../state';

export type BitmapConversionOutcome =
  | { readonly kind: 'converted' | 'cancelled' | 'stale' }
  | { readonly kind: 'error'; readonly message: string };

export async function convertSelectedVectorsToBitmap(
  convertibles: ReadonlyArray<ConvertibleVector>,
  layers: ReadonlyArray<Layer>,
  options: ConvertToBitmapDialogOptions,
  convertToBitmap: (sourceIds: ReadonlyArray<string>, raster: RasterImage) => void,
  pushToast: (message: string, variant?: ToastVariant) => void,
  signal?: AbortSignal,
): Promise<BitmapConversionOutcome> {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  const layerInputs = layers.map(({ id, color, mode }) => ({ id, color, mode }));
  const owner = {
    projectDocumentEpoch: useStore.getState().projectDocumentEpoch,
    sources: [...convertibles],
    layers: options.renderType === 'use-cut-settings' ? layerInputs : undefined,
  };
  if (signal?.aborted) return { kind: 'cancelled' };
  if (!conversionOwnerIsCurrent(owner)) return { kind: 'stale' };
  signal?.addEventListener('abort', cancel, { once: true });
  let stale = false;
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (
      state.project === previous.project &&
      state.projectDocumentEpoch === previous.projectDocumentEpoch
    )
      return;
    if (conversionOwnerIsCurrent(owner)) return;
    stale = true;
    controller.abort();
  });
  const obsolete = (): BitmapConversionOutcome | null => {
    if (stale || !conversionOwnerIsCurrent(owner)) return { kind: 'stale' };
    return controller.signal.aborted ? { kind: 'cancelled' } : null;
  };
  try {
    const raster = await buildBitmapFromVectors(
      convertibles,
      { ...options, layers: layerInputs },
      controller.signal,
    );
    const stopped = obsolete();
    if (stopped !== null) return stopped;
    // The successful scene swap invalidates its own sources; stop watching first.
    unsubscribe();
    convertToBitmap(
      convertibles.map((convertible) => convertible.id),
      raster,
    );
    pushToast(`Converted to bitmap: ${raster.source}`, 'success');
    return { kind: 'converted' };
  } catch (err) {
    const stopped = obsolete();
    if (stopped !== null) return stopped;
    if (isAbortError(err)) return { kind: 'cancelled' };
    const message = err instanceof Error ? err.message : String(err);
    pushToast(`Could not convert to bitmap: ${message}`, 'error');
    return { kind: 'error', message };
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', cancel);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function conversionOwnerIsCurrent(owner: {
  readonly projectDocumentEpoch: number;
  readonly sources: ReadonlyArray<ConvertibleVector>;
  readonly layers: ReadonlyArray<Pick<Layer, 'id' | 'color' | 'mode'>> | undefined;
}): boolean {
  const state = useStore.getState();
  if (state.projectDocumentEpoch !== owner.projectDocumentEpoch) return false;
  if (owner.layers !== undefined) {
    const current = state.project.scene.layers;
    if (current.length !== owner.layers.length) return false;
    if (
      owner.layers.some((layer, index) => {
        const next = current[index];
        return next?.id !== layer.id || next.color !== layer.color || next.mode !== layer.mode;
      })
    )
      return false;
  }
  if (owner.sources.length === 0) return false;
  const currentObjects = new Map(state.project.scene.objects.map((object) => [object.id, object]));
  return owner.sources.every((source) => currentObjects.get(source.id) === source);
}
