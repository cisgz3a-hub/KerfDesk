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
import { confirmOversizeImport } from '../app/import-size-guard';

/** Imports the file into the scene; resolves with the created object (null
 * when skipped or failed) so callers like Image Studio can chain onto it. */
export async function importImageFile(
  file: File,
  importRasterImage: (object: SceneObject) => void,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<SceneObject | null> {
  // F-A3: confirm before importing a very large file (both the toolbar picker
  // and drag-drop route through here).
  if (!confirmOversizeImport(file.name, file.size)) return null;
  try {
    const natural = await readImageNaturalSize(file);
    const image = await loadImageAsRawData(file, burnDecodeMaxEdge(natural.width, natural.height));
    const density = await readImageDensity(file);
    const geometry = rasterImportGeometry({
      naturalWidth: natural.width,
      naturalHeight: natural.height,
      sampledWidth: image.width,
      sampledHeight: image.height,
      ...(density !== null ? { dpi: density } : {}),
    });
    const object: SceneObject = {
      kind: 'raster-image',
      id: crypto.randomUUID(),
      source: file.name,
      dataUrl: await readFileAsDataUrl(file),
      pixelWidth: geometry.pixelWidth,
      pixelHeight: geometry.pixelHeight,
      bounds: geometry.bounds,
      transform: IDENTITY_TRANSFORM,
      color: DEFAULT_RASTER_LAYER_COLOR,
      dither: 'floyd-steinberg',
      linesPerMm: 10,
      lumaBase64: extractLumaBase64(image),
    };
    importRasterImage(object);
    pushToast(
      `Added image: ${file.name} (${describeImportedImageSize(natural, image)})`,
      'success',
    );
    return object;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushToast(`Could not load image: ${message}`, 'error');
    return null;
  }
}
