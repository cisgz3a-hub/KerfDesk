import { normalizeImageDensity } from '../common/image-density';

type ChunkHeader = { readonly length: number; readonly type: string };
type PngFormat = { readonly bitDepth: number; readonly colorType: number };
type TransparencyPublisher = (value: {
  readonly kind: 'grayscale-sample';
  readonly sample: number;
}) => void | Promise<void>;

/** Validate and publish a grayscale transparent code without rescaling its source precision. */
export async function grayscaleTransparencyFromChunk(
  chunk: ChunkHeader,
  format: PngFormat,
  afterImageData: boolean,
  bytes: Uint8Array,
  current: number | undefined,
  publish: TransparencyPublisher | undefined,
): Promise<number | undefined> {
  if (chunk.type !== 'tRNS' || format.colorType !== 0) return current;
  if (afterImageData) throw new Error('PNG tRNS chunk must precede IDAT image data.');
  if (current !== undefined) throw new Error('PNG may contain only one tRNS chunk.');
  if (chunk.length !== 2 || bytes.byteLength !== 2) {
    throw new Error('PNG grayscale tRNS chunk must contain exactly 2 bytes.');
  }
  const stored = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0);
  // PNG 3 section 11.3.1.1 requires decoders to ignore unused high bits.
  const sample = stored & (2 ** format.bitDepth - 1);
  await publish?.({ kind: 'grayscale-sample', sample });
  return sample;
}

/** Reject PLTE only for grayscale types where the PNG specification forbids it. */
export function validatePaletteForColorType(type: string, colorType: number): void {
  if (type !== 'PLTE' || (colorType !== 0 && colorType !== 4)) return;
  throw new Error(`PNG PLTE is not permitted for grayscale color type ${colorType}.`);
}

/** Resolve a pre-IDAT pHYs chunk into the existing normalized DPI metadata. */
export function densityFromChunk(
  type: string,
  afterImageData: boolean,
  bytes: Uint8Array,
  current: number | null,
): number | null {
  if (type !== 'pHYs' || afterImageData) return current;
  if (bytes.byteLength !== 9 || bytes[8] !== 1) return null;
  const pixelsPerMetre = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    0,
  );
  return pixelsPerMetre > 0 ? normalizeImageDensity(Math.round(pixelsPerMetre * 0.0254)) : null;
}
