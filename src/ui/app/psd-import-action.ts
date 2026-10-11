import { DEFAULT_RASTER_LAYER_COLOR, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import {
  rasterImportGeometry,
  describeImportDensity,
  describeImportedImageSize,
} from '../common/image-import';
import { preparePsdOffThread } from '../import/import-worker-client';
import type { PreparedPsdImport } from '../import/psd-import-preparation';
import type { ImportOutcome } from '../state/store';
import { useStore } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { describeImportBedFit } from './import-bed-fit-notice';
import { isImportCancellation } from './import-worker-controls';
import { largeImportAdvisory } from './import-size-advisory';

type PsdImportActions = {
  readonly isCurrent: () => boolean;
  readonly importRasterImage: (object: RasterImage) => ImportOutcome | undefined;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

export async function importPsdFile(file: File, actions: PsdImportActions): Promise<void> {
  const controller = new AbortController();
  const cancel = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') controller.abort();
  };
  const unsubscribe = useStore.subscribe(() => {
    if (!actions.isCurrent()) controller.abort();
  });
  window.addEventListener('keydown', cancel);
  const toast = (message: string, variant?: ToastVariant): void => {
    if (actions.isCurrent()) actions.pushToast(message, variant);
  };
  try {
    if (!actions.isCurrent()) return;
    const advisory = largeImportAdvisory(file.name, file.size);
    if (advisory !== null) toast(advisory, 'warning');
    const pending = preparePsdOffThread(file, { signal: controller.signal });
    if (pending === null)
      throw new Error(
        'PSD import needs a background image worker, which is unavailable. Export PNG and import it instead.',
      );
    toast(`${file.name}: preparing the merged image. Press Esc to cancel.`, 'info');
    const prepared = await pending;
    controller.signal.throwIfAborted();
    if (!actions.isCurrent()) return;
    const geometry = rasterImportGeometry({
      naturalWidth: prepared.natural.width,
      naturalHeight: prepared.natural.height,
      sampledWidth: prepared.sampled.width,
      sampledHeight: prepared.sampled.height,
      density: prepared.density,
    });
    const outcome = actions.importRasterImage(psdRasterObject(file.name, prepared, geometry));
    if (prepared.hasColorProfile)
      toast(
        'PSD colours use the stored RGB values; its embedded colour profile was not converted.',
        'warning',
      );
    toast(
      `Added merged PSD image: ${file.name} (${describeImportedImageSize(prepared.natural, prepared.sampled)} · ${describeImportDensity(geometry)}). Layers remain flattened.`,
      'success',
    );
    const fit = describeImportBedFit(file.name, outcome);
    if (fit !== null) toast(fit.message, fit.variant);
  } catch (error) {
    const cancelled = controller.signal.aborted || isImportCancellation(error);
    toast(
      cancelled
        ? `${file.name}: import cancelled.`
        : `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
      cancelled ? 'info' : 'error',
    );
  } finally {
    unsubscribe();
    window.removeEventListener('keydown', cancel);
  }
}

function psdRasterObject(
  source: string,
  prepared: PreparedPsdImport,
  geometry: ReturnType<typeof rasterImportGeometry>,
): RasterImage {
  return {
    kind: 'raster-image',
    id: crypto.randomUUID(),
    source,
    dataUrl: prepared.dataUrl,
    lumaBase64: prepared.lumaBase64,
    pixelWidth: geometry.pixelWidth,
    pixelHeight: geometry.pixelHeight,
    bounds: geometry.bounds,
    transform: IDENTITY_TRANSFORM,
    color: DEFAULT_RASTER_LAYER_COLOR,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}
