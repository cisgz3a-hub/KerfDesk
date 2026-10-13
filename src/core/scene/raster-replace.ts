// Replace, Replace to Fit and Refresh for a placed image (LightBurn's bitmap
// Replace Image / Replace to Fit / Refresh). The image keeps its id, position,
// rotation, mirror, operation, engrave settings, mask and clip; only the
// picture changes. 'natural' uses the new file's own size; 'fit' fits it inside
// the old image's box, keeping its aspect ratio. Either way the image stays
// centred where the old one was.

import type { RasterImage, Vec2 } from './scene-object';
import { applyTransform } from './transform';

export type RasterReplaceMode = 'natural' | 'fit';

/** The picture fields a fresh import brings; everything else stays with the placed image. */
type Picture = Pick<
  RasterImage,
  'source' | 'dataUrl' | 'imageAsset' | 'lumaBase64' | 'pixelWidth' | 'pixelHeight' | 'bounds'
>;

export function replaceRasterPicture(
  target: RasterImage,
  incoming: RasterImage,
  mode: RasterReplaceMode,
): RasterImage {
  const old = target.bounds;
  const oldWidth = old.maxX - old.minX;
  const oldHeight = old.maxY - old.minY;
  const naturalWidth = incoming.bounds.maxX - incoming.bounds.minX;
  const naturalHeight = incoming.bounds.maxY - incoming.bounds.minY;
  const k =
    mode === 'fit' && naturalWidth > 0 && naturalHeight > 0
      ? Math.min(oldWidth / naturalWidth, oldHeight / naturalHeight)
      : 1;
  const width = naturalWidth * k;
  const height = naturalHeight * k;
  const bounds = {
    minX: old.minX,
    minY: old.minY,
    maxX: old.minX + width,
    maxY: old.minY + height,
  };
  const picture: Picture = {
    source: incoming.source,
    ...(incoming.dataUrl === undefined ? {} : { dataUrl: incoming.dataUrl }),
    ...(incoming.imageAsset === undefined ? {} : { imageAsset: incoming.imageAsset }),
    ...(incoming.lumaBase64 === undefined ? {} : { lumaBase64: incoming.lumaBase64 }),
    pixelWidth: incoming.pixelWidth,
    pixelHeight: incoming.pixelHeight,
    bounds,
  };
  // The old picture's sources and its photo edits belong to the old picture.
  const {
    dataUrl: _dataUrl,
    imageAsset: _imageAsset,
    lumaBase64: _luma,
    editorDocument: _editor,
    ...kept
  } = target;
  const centre = (b: typeof bounds): Vec2 => ({
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
  });
  const was = applyTransform(centre(old), target.transform);
  const now = applyTransform(centre(bounds), target.transform);
  return {
    ...kept,
    ...picture,
    transform: {
      ...target.transform,
      x: target.transform.x + was.x - now.x,
      y: target.transform.y + was.y - now.y,
    },
  };
}
