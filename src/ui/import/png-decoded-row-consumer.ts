import { consumePngFilteredRows } from './png-filtered-row-reader';
import { consumePngLumaRows, type QualifiedPngHeader } from './png-row-luma-sampler';

/** Internal row interpretation selected after the PNG header is qualified. */
export type PngRowDecodeMode = 'luma-u8' | 'exact-grayscale' | 'exact-heightfield';

type Target = { readonly width: number; readonly height: number };
type Source = { readonly width: number; readonly height: number };
type Format = { readonly bitDepth: number; readonly colorType: number };
type DecodeFormat = Format & {
  readonly compression: number;
  readonly filter: number;
  readonly interlace: number;
};
type RowOptions = {
  readonly signal?: AbortSignal;
  readonly onRow: (row: Uint8Array) => void | Promise<void>;
};

/** Route reconstructed PNG bytes through display luma or an exact heightfield lane. */
export function consumeDecodedPngRows(
  readable: ReadableStream<Uint8Array>,
  source: Source,
  target: Target,
  format: Format,
  options: RowOptions,
  mode: PngRowDecodeMode,
): Promise<void> {
  if (mode === 'luma-u8') {
    const header: QualifiedPngHeader = {
      ...source,
      channels: format.colorType === 0 ? 1 : format.colorType === 6 ? 4 : 3,
    };
    return consumePngLumaRows(readable, header, target, options.signal, options.onRow);
  }
  const bytesPerPixel = format.colorType === 4 ? 2 : format.bitDepth / 8;
  return consumePngFilteredRows(
    readable,
    {
      height: source.height,
      rowBytes: source.width * bytesPerPixel,
      bytesPerPixel,
    },
    options.signal,
    options.onRow,
  );
}

/** Return the compatibility reason before a PNG row decoder is selected. */
export function pngDecodeFallbackReason(
  format: DecodeFormat,
  mode: PngRowDecodeMode,
): string | null {
  const sampleReason = sampleFallbackReason(format, mode);
  if (sampleReason !== null) return sampleReason;
  if (format.compression !== 0) {
    return `PNG compression method ${format.compression} is not qualified`;
  }
  if (format.filter !== 0) return `PNG filter method ${format.filter} is not qualified`;
  if (format.interlace !== 0) return 'interlaced PNG is not yet qualified';
  return null;
}

function sampleFallbackReason(format: Format, mode: PngRowDecodeMode): string | null {
  if (mode === 'exact-grayscale') {
    if (format.colorType !== 0) return `PNG color type ${format.colorType} is not qualified`;
    return format.bitDepth === 8 || format.bitDepth === 16
      ? null
      : `PNG bit depth ${format.bitDepth} is not qualified`;
  }
  if (mode === 'exact-heightfield') return heightfieldSampleFallbackReason(format);
  if (format.bitDepth !== 8) return `PNG bit depth ${format.bitDepth} is not yet qualified`;
  if (format.colorType !== 0 && format.colorType !== 2 && format.colorType !== 6) {
    return `PNG color type ${format.colorType} is not yet qualified`;
  }
  return null;
}

function heightfieldSampleFallbackReason(format: Format): string | null {
  if (format.colorType === 0) {
    return format.bitDepth === 8 || format.bitDepth === 16
      ? null
      : `PNG bit depth ${format.bitDepth} is not qualified`;
  }
  if (format.colorType === 4) {
    return format.bitDepth === 8
      ? null
      : `PNG bit depth ${format.bitDepth} is not qualified for grayscale-alpha color type 4`;
  }
  return `PNG color type ${format.colorType} is not qualified`;
}
