import type { RasterImage, SceneObject } from '../../core/scene';
import { readRasterSourceFile } from '../import/paged-raster-source';

/** Embed original pixels for portable SVGs; paged thumbnails are display-only. */
export async function embedSvgRasterImages(
  objects: ReadonlyArray<SceneObject>,
  readSource: (image: RasterImage) => Promise<string> = svgImageSource,
): Promise<SceneObject[]> {
  return Promise.all(
    objects.map(async (object) => {
      if (object.kind !== 'raster-image') return object;
      const { imageAsset: _asset, ...image } = object;
      return { ...image, dataUrl: await readSource(object) };
    }),
  );
}

async function svgImageSource(image: RasterImage): Promise<string> {
  if (image.imageAsset === undefined && image.dataUrl !== undefined) return image.dataUrl;
  const file = await readRasterSourceFile(image, image.source);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image pixels for SVG export.'));
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('The image source did not contain bytes.'));
    reader.readAsDataURL(file);
  });
}
