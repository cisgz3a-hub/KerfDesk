import { consumePngFilteredRows } from './png-filtered-row-reader';
import { consumePngLumaRows, type QualifiedPngHeader } from './png-row-luma-sampler';

/** Internal row interpretation selected after the PNG header is qualified. */
export type PngRowDecodeMode = 'luma-u8' | 'exact-grayscale';

type Target = { readonly width: number; readonly height: number };
type RowOptions = {
  readonly signal?: AbortSignal;
  readonly onRow: (row: Uint8Array) => void | Promise<void>;
};

/** Route reconstructed PNG bytes either through display luma or the exact grayscale lane. */
export function consumeDecodedPngRows(
  readable: ReadableStream<Uint8Array>,
  header: QualifiedPngHeader,
  target: Target,
  bitDepth: number,
  options: RowOptions,
  mode: PngRowDecodeMode,
): Promise<void> {
  if (mode === 'luma-u8') {
    return consumePngLumaRows(readable, header, target, options.signal, options.onRow);
  }
  const bytesPerSample = bitDepth / 8;
  return consumePngFilteredRows(
    readable,
    {
      height: header.height,
      rowBytes: header.width * bytesPerSample,
      bytesPerPixel: bytesPerSample,
    },
    options.signal,
    options.onRow,
  );
}
