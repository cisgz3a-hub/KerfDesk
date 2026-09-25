import { DEFAULT_RASTER_LAYER_COLOR, IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import { readFileAsDataUrl } from '../trace/image-loader';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { readImageDensity } from '../common/image-density';
import {
  describeImportedImageSize,
  describeImportDensity,
  rasterImportGeometry,
} from '../common/image-import';
import type { ImageDensity } from '../common/image-density';
import { describeImportBedFit } from '../app/import-bed-fit-notice';
import { largeImportAdvisory } from '../app/import-size-advisory';
import {
  shouldDecodeDimensionQualifiedPng,
  shouldPageBackPng,
} from '../import/qualified-png-raster';
import type { PngImportWorkerProgress } from '../import/png-import-worker-client';
import { freezeGif, isGif } from '../import/freeze-gif';
import { loadImageSamples, type LoadedImageSamples } from '../import/prepare-image-samples';

/** Imports the file into the scene; resolves with the created object (null
 * when skipped or failed) so callers like Image Studio can chain onto it. */
export async function importImageFile(
  file: File,
  importRasterImage: (object: SceneObject) => ImportOutcome | undefined,
  pushToast: (message: string, variant?: ToastVariant) => void,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SceneObject | null> {
  // F-A3: advise (never refuse) before importing a very large file — both the
  // toolbar picker and drag-drop route through here.
  const advisory = largeImportAdvisory(file.name, file.size);
  if (advisory !== null) pushToast(advisory, 'warning');
  let controls: PngImportControls | null = null;
  let rollback: (() => Promise<string | null>) | null = null;
  try {
    assertImportActive(options.signal);
    const gif = isGif(file);
    file = await staticImage(file);
    // Storage ownership and worker ownership are distinct. A compressed PNG
    // can remain portable while still requiring the queued worker because its
    // encoded edge exceeds the browser canvas boundary.
    const pageBacked = shouldPageBackPng(file);
    const dimensionQualified = !pageBacked && (await shouldDecodeDimensionQualifiedPng(file));
    controls =
      pageBacked || dimensionQualified
        ? createPngImportControls(file.name, pushToast, options.signal)
        : null;
    const loaded = await loadImageSamples(file, pageBacked, dimensionQualified, controls?.options);
    warnImageCleanup(loaded, pushToast);
    rollback = loaded.kind === 'paged' ? loaded.rollback : null;
    assertImportActive(options.signal);
    const imported = await importedRasterObject(file, loaded);
    assertImportActive(options.signal);
    const outcome = importRasterImage(imported.object);
    rollback = null;
    pushToast(
      `Added image: ${file.name} (${describeImportedImageSize(loaded.natural, loaded.sampled)} · ${describeImportDensity(imported.geometry)})`,
      'success',
    );
    if (gif) pushToast('GIF imported as a still image of its first frame.', 'info');
    const fitNotice = describeImportBedFit(file.name, outcome);
    if (fitNotice !== null) pushToast(fitNotice.message, fitNotice.variant);
    return imported.object;
  } catch (err) {
    return handleFailedImport(file.name, err, rollback, pushToast);
  } finally {
    controls?.dispose();
  }
}

function staticImage(file: File): Promise<File> {
  return isGif(file) ? freezeGif(file) : Promise.resolve(file);
}

function assertImportActive(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function warnImageCleanup(
  loaded: LoadedImageSamples,
  pushToast: (message: string, variant?: ToastVariant) => void,
): void {
  if (loaded.kind === 'embedded' && loaded.cleanupWarning !== undefined) {
    pushToast(loaded.cleanupWarning, 'warning');
  }
}

async function importedRasterObject(
  file: File,
  loaded: LoadedImageSamples,
): Promise<{
  readonly object: SceneObject;
  readonly geometry: ReturnType<typeof rasterImportGeometry>;
}> {
  let density: ImageDensity | null;
  if (loaded.kind === 'paged') {
    density = loaded.density;
  } else if (loaded.density !== undefined) {
    density = loaded.density;
  } else {
    density = await readImageDensity(file);
  }
  const geometry = rasterImportGeometry({
    naturalWidth: loaded.natural.width,
    naturalHeight: loaded.natural.height,
    sampledWidth: loaded.sampled.width,
    sampledHeight: loaded.sampled.height,
    density,
  });
  const source =
    loaded.kind === 'paged'
      ? { imageAsset: loaded.imageAsset }
      : { dataUrl: await readFileAsDataUrl(file), lumaBase64: loaded.lumaBase64 };
  const object: SceneObject = {
    kind: 'raster-image',
    id: crypto.randomUUID(),
    source: file.name,
    ...source,
    pixelWidth: geometry.pixelWidth,
    pixelHeight: geometry.pixelHeight,
    bounds: geometry.bounds,
    transform: IDENTITY_TRANSFORM,
    color: DEFAULT_RASTER_LAYER_COLOR,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
  return { object, geometry };
}

async function handleFailedImport(
  name: string,
  error: unknown,
  rollback: (() => Promise<string | null>) | null,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<null> {
  const cleanupWarning = await rollback?.();
  if (cleanupWarning !== null && cleanupWarning !== undefined) {
    pushToast(cleanupWarning, 'warning');
  }
  if (isAbortError(error)) {
    pushToast(`${name}: import cancelled.`, 'info');
    return null;
  }
  const message = error instanceof Error ? error.message : String(error);
  pushToast(`Could not load image: ${message}`, 'error');
  return null;
}

type PngImportControls = {
  readonly options: {
    readonly signal: AbortSignal;
    readonly onProgress: (progress: PngImportWorkerProgress) => void;
  };
  readonly dispose: () => void;
};

function createPngImportControls(
  name: string,
  pushToast: (message: string, variant?: ToastVariant) => void,
  signal?: AbortSignal,
): PngImportControls {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (signal?.aborted === true) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let lastPhase = '';
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') controller.abort();
  };
  window.addEventListener('keydown', handleKeyDown);
  return {
    options: {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === lastPhase) return;
        lastPhase = progress.phase;
        pushToast(pngProgressMessage(name, progress), 'info');
      },
    },
    dispose: () => {
      window.removeEventListener('keydown', handleKeyDown);
      signal?.removeEventListener('abort', abort);
    },
  };
}

function pngProgressMessage(name: string, progress: PngImportWorkerProgress): string {
  if (progress.phase === 'queued') {
    return `${name}: queued behind ${progress.queuePosition} import(s). Press Esc to cancel.`;
  }
  if (progress.phase === 'persisting-source') {
    return `${name}: staging source in worker. Press Esc to cancel.`;
  }
  if (progress.phase === 'decoding') {
    return `${name}: decoding and sampling in worker. Press Esc to cancel.`;
  }
  return `${name}: storing sampled rows in worker. Press Esc to cancel.`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
