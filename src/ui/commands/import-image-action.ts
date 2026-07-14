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

export async function importImageFile(
  file: File,
  importRasterImage: (object: SceneObject) => void,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<void> {
  // F-A3: confirm before importing a very large file (both the toolbar picker
  // and drag-drop route through here).
  if (!confirmOversizeImport(file.name, file.size)) return;
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
    importRasterImage({
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
    });
    pushToast(
      `Added image: ${file.name} (${describeImportedImageSize(natural, image)})`,
      'success',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushToast(`Could not load image: ${message}`, 'error');
  }
}
