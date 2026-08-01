import { DEFAULT_RASTER_LAYER_COLOR, IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import {
  burnDecodeMaxEdge,
  extractLumaBase64,
  loadImageAsRawData,
  readFileAsDataUrl,
  readImageNaturalSize,
} from '../trace/image-loader';
import type { ToastVariant } from '../state/toast-store';
import { readImageDensity } from '../common/image-density';
import { describeImportedImageSize, rasterImportGeometry } from '../common/image-import';
import { largeImportAdvisory } from '../app/import-size-advisory';
import { shouldPageBackPng, tryDecodeQualifiedPng } from '../import/qualified-png-raster';
import type { PngImportWorkerProgress } from '../import/png-import-worker-client';

/** Imports the file into the scene; resolves with the created object (null
 * when skipped or failed) so callers like Image Studio can chain onto it. */
export async function importImageFile(
  file: File,
  importRasterImage: (object: SceneObject) => void,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<SceneObject | null> {
  // F-A3: advise (never refuse) before importing a very large file — both the
  // toolbar picker and drag-drop route through here.
  const advisory = largeImportAdvisory(file.name, file.size);
  if (advisory !== null) pushToast(advisory, 'warning');
  // One routing decision for the whole import: it selects the storage
  // representation and therefore whether worker-progress toasts apply at all.
  const pageBacked = shouldPageBackPng(file);
  const controls = pageBacked ? createPngImportControls(file.name, pushToast) : null;
  let rollback: (() => Promise<string | null>) | null = null;
  try {
    const loaded = await loadImageSamples(file, pageBacked, controls?.options);
    rollback = loaded.kind === 'paged' ? loaded.rollback : null;
    const object = await importedRasterObject(file, loaded);
    importRasterImage(object);
    rollback = null;
    pushToast(
      `Added image: ${file.name} (${describeImportedImageSize(loaded.natural, loaded.sampled)})`,
      'success',
    );
    return object;
  } catch (err) {
    return handleFailedImport(file.name, err, rollback, pushToast);
  } finally {
    controls?.dispose();
  }
}

type ImageDimensions = { readonly width: number; readonly height: number };
type LoadedImageSamples =
  | {
      readonly kind: 'embedded';
      readonly natural: ImageDimensions;
      readonly sampled: ImageDimensions;
      readonly lumaBase64: string;
    }
  | {
      readonly kind: 'paged';
      readonly natural: ImageDimensions;
      readonly sampled: ImageDimensions;
      readonly imageAsset: NonNullable<
        Extract<SceneObject, { readonly kind: 'raster-image' }>['imageAsset']
      >;
      readonly densityDpi: number | null;
      readonly rollback: () => Promise<string | null>;
    };

async function importedRasterObject(file: File, loaded: LoadedImageSamples): Promise<SceneObject> {
  const density = loaded.kind === 'paged' ? loaded.densityDpi : await readImageDensity(file);
  const geometry = rasterImportGeometry({
    naturalWidth: loaded.natural.width,
    naturalHeight: loaded.natural.height,
    sampledWidth: loaded.sampled.width,
    sampledHeight: loaded.sampled.height,
    ...(density === null ? {} : { dpi: density }),
  });
  const source =
    loaded.kind === 'paged'
      ? { imageAsset: loaded.imageAsset }
      : { dataUrl: await readFileAsDataUrl(file), lumaBase64: loaded.lumaBase64 };
  return {
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

async function loadImageSamples(
  file: File,
  pageBacked: boolean,
  options: PngImportControls['options'] | undefined,
): Promise<LoadedImageSamples> {
  const qualified = pageBacked ? await tryDecodeQualifiedPng(file, options) : null;
  if (qualified !== null) return { kind: 'paged', ...qualified };
  const natural = await readImageNaturalSize(file);
  const sampled = await loadImageAsRawData(file, burnDecodeMaxEdge(natural.width, natural.height));
  return {
    kind: 'embedded',
    natural,
    sampled,
    lumaBase64: extractLumaBase64(sampled),
  };
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
): PngImportControls {
  const controller = new AbortController();
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
    dispose: () => window.removeEventListener('keydown', handleKeyDown),
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
