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
import { decodeBurnLumaOffThread } from './image-luma-worker-client';

type ImageDimensions = { readonly width: number; readonly height: number };

export type ImageSamplesOptions = QualifiedPngDecodeOptions & {
  /** The embedded decode is taking long enough to show its progress notice. */
  readonly onSlowDecode?: () => void;
};

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
  options: ImageSamplesOptions = {},
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
  const natural = await readImageNaturalSize(file, options.signal);
  const maxEdge = burnDecodeMaxEdge(natural.width, natural.height);
  // Decode, sampling and luma run in a worker; the UI-thread loader below is
  // the fallback for engines or files the worker cannot reproduce exactly.
  const offThread = await decodeBurnLumaOffThread(file, maxEdge, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onSlowDecode === undefined ? {} : { onSlow: options.onSlowDecode }),
  });
  if (offThread !== null) return { kind: 'embedded', natural, ...offThread };
  const sampled = await loadImageAsRawData(file, maxEdge, options.signal);
  return {
    kind: 'embedded',
    natural,
    sampled,
    lumaBase64: extractLumaBase64(sampled),
  };
}
