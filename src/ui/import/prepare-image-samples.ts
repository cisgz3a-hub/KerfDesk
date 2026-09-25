import type { RasterImage } from '../../core/scene';
import type { ImageDensity } from '../common/image-density';
import {
  burnDecodeMaxEdge,
  extractLumaBase64,
  loadImageAsRawData,
  readImageNaturalSize,
} from '../trace/image-loader';
import {
  tryDecodeDimensionQualifiedPng,
  tryDecodeQualifiedPng,
  type QualifiedPngDecodeOptions,
} from './qualified-png-raster';

type ImageDimensions = { readonly width: number; readonly height: number };

export type LoadedImageSamples =
  | {
      readonly kind: 'embedded';
      readonly natural: ImageDimensions;
      readonly sampled: ImageDimensions;
      readonly lumaBase64: string;
      readonly density?: ImageDensity | null;
      readonly cleanupWarning?: string;
    }
  | {
      readonly kind: 'paged';
      readonly natural: ImageDimensions;
      readonly sampled: ImageDimensions;
      readonly imageAsset: NonNullable<RasterImage['imageAsset']>;
      readonly density: ImageDensity | null;
      readonly rollback: () => Promise<string | null>;
    };

/** Decode samples without inserting artwork. A paged result transfers temporary
 * asset ownership to its caller until insertion succeeds or rollback finishes. */
export async function loadImageSamples(
  file: File,
  pageBacked: boolean,
  dimensionQualified: boolean,
  options: QualifiedPngDecodeOptions = {},
): Promise<LoadedImageSamples> {
  if (pageBacked) {
    const qualified = await tryDecodeQualifiedPng(file, options);
    if (qualified !== null) return { kind: 'paged', ...qualified };
  } else if (dimensionQualified) {
    const qualified = await tryDecodeDimensionQualifiedPng(file, options);
    if (qualified !== null) {
      return {
        kind: 'embedded',
        natural: qualified.natural,
        sampled: qualified.sampled,
        lumaBase64: qualified.lumaBase64,
        density: qualified.density,
        ...(qualified.cleanupWarning === null ? {} : { cleanupWarning: qualified.cleanupWarning }),
      };
    }
  }
  const natural = await readImageNaturalSize(file);
  const sampled = await loadImageAsRawData(file, burnDecodeMaxEdge(natural.width, natural.height));
  return {
    kind: 'embedded',
    natural,
    sampled,
    lumaBase64: extractLumaBase64(sampled),
  };
}
