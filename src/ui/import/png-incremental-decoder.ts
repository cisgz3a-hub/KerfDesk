import { pngSamplingTarget } from './png-row-luma-sampler';
import {
  grayscaleTransparencyFromChunk,
  validateHeightfieldTransparencyForColorType,
  validatePaletteForColorType,
} from './png-chunk-metadata';
import {
  consumeDecodedPngRows,
  pngDecodeFallbackReason,
  type PngRowDecodeMode as DecodeMode,
} from './png-decoded-row-consumer';
import {
  finishPngCrc,
  PngStreamReader,
  startPngCrc,
  throwIfAborted,
  updatePngCrc,
} from './png-stream-reader';
import { normalizeImageDensity, type ImageDensity } from '../common/image-density';

export type IncrementalPngProgress = {
  readonly phase: 'decoding';
  readonly encodedBytes: number;
};

export type IncrementalPngTransparency = {
  readonly kind: 'grayscale-sample';
  readonly sample: number;
};

export type IncrementalPngResult =
  | {
      readonly kind: 'ok';
      readonly width: number;
      readonly height: number;
      readonly sampledWidth: number;
      readonly sampledHeight: number;
      readonly bitDepth: number;
      readonly colorType: number;
      readonly density: ImageDensity | null;
    }
  | { readonly kind: 'legacy-fallback'; readonly reason: string };

export type IncrementalPngOptions = {
  readonly maxEdge: number;
  readonly maxPixels: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: IncrementalPngProgress) => void;
  readonly onHeader?: (result: IncrementalPngHeaderResult) => void | Promise<void>;
  readonly onTransparency?: (transparency: IncrementalPngTransparency) => void | Promise<void>;
  readonly onRow: (row: Uint8Array) => void | Promise<void>;
};

/** Streaming callbacks for exact source-sized grayscale sample rows. */
export type IncrementalGrayscalePngOptions = Omit<IncrementalPngOptions, 'maxEdge' | 'maxPixels'>;

/** Streaming callbacks for exact source-sized grayscale or grayscale-alpha rows. */
export type IncrementalHeightfieldPngOptions = Omit<IncrementalPngOptions, 'maxEdge' | 'maxPixels'>;

export type IncrementalPngHeaderResult = Omit<
  Extract<IncrementalPngResult, { readonly kind: 'ok' }>,
  'density'
>;

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

export async function decodeIncrementalPngToLuma(
  chunks: AsyncIterable<Uint8Array>,
  options: IncrementalPngOptions,
): Promise<IncrementalPngResult> {
  return decodeIncrementalPng(chunks, options, 'luma-u8');
}

/** Decode exact non-interlaced grayscale sample bytes without luma conversion or resampling. */
export async function decodeIncrementalPngToGrayscaleSamples(
  chunks: AsyncIterable<Uint8Array>,
  options: IncrementalGrayscalePngOptions,
): Promise<IncrementalPngResult> {
  return decodeIncrementalPng(
    chunks,
    { ...options, maxEdge: Number.MAX_SAFE_INTEGER, maxPixels: Number.MAX_SAFE_INTEGER },
    'exact-grayscale',
  );
}

/** Decode exact non-interlaced heightfield rows without luma conversion or resampling. */
export async function decodeIncrementalPngToHeightfieldSamples(
  chunks: AsyncIterable<Uint8Array>,
  options: IncrementalHeightfieldPngOptions,
): Promise<IncrementalPngResult> {
  return decodeIncrementalPng(
    chunks,
    { ...options, maxEdge: Number.MAX_SAFE_INTEGER, maxPixels: Number.MAX_SAFE_INTEGER },
    'exact-heightfield',
  );
}

async function decodeIncrementalPng(
  chunks: AsyncIterable<Uint8Array>,
  options: IncrementalPngOptions,
  mode: DecodeMode,
): Promise<IncrementalPngResult> {
  const reader = new PngStreamReader(chunks, options.signal, (encodedBytes) => {
    options.onProgress?.({ phase: 'decoding', encodedBytes });
  });
  assertPositiveBudget(options.maxEdge, 'maxEdge');
  assertPositiveBudget(options.maxPixels, 'maxPixels');
  assertSignature(await reader.readExact(SIGNATURE.length));
  const first = await readChunkHeader(reader);
  if (first.type !== 'IHDR' || first.length !== 13) {
    throw new Error('PNG IHDR must be the first chunk and contain 13 bytes.');
  }
  const ihdr = await readChunkData(reader, first);
  const header = parseHeader(ihdr);
  const fallback = pngDecodeFallbackReason(header, mode);
  if (fallback !== null) return { kind: 'legacy-fallback', reason: fallback };
  const source = { width: header.width, height: header.height };
  const target =
    mode !== 'luma-u8'
      ? { width: header.width, height: header.height }
      : pngSamplingTarget(header.width, header.height, options.maxEdge, options.maxPixels);
  await options.onHeader?.({
    kind: 'ok',
    width: header.width,
    height: header.height,
    sampledWidth: target.width,
    sampledHeight: target.height,
    bitDepth: header.bitDepth,
    colorType: header.colorType,
  });
  return decodeIdat(reader, source, target, header, options, mode);
}

async function decodeIdat(
  reader: PngStreamReader,
  source: { readonly width: number; readonly height: number },
  target: { readonly width: number; readonly height: number },
  format: Pick<PngHeader, 'bitDepth' | 'colorType'>,
  options: IncrementalPngOptions,
  mode: DecodeMode,
): Promise<IncrementalPngResult> {
  if (typeof DecompressionStream === 'undefined') {
    return { kind: 'legacy-fallback', reason: 'streaming deflate is unavailable' };
  }
  const decompressor = new DecompressionStream('deflate');
  const writer = decompressor.writable.getWriter();
  const rows = settledRows(
    consumeDecodedPngRows(decompressor.readable, source, target, format, options, mode),
  );
  let sawIdat = false;
  let idatEnded = false;
  let transparentGraySample: number | undefined;
  let density: ImageDensity | null = null;
  try {
    while (true) {
      throwIfAborted(options.signal);
      const chunk = await readChunkHeader(reader);
      if (chunk.type === 'IDAT') {
        if (idatEnded) throw new Error('PNG IDAT chunks must be consecutive.');
        sawIdat = true;
        await readChunkData(reader, chunk, async (segment) => writer.write(streamBytes(segment)));
        continue;
      }
      if (sawIdat) idatEnded = true;
      const data = await readChunkData(reader, chunk);
      validatePaletteForColorType(chunk.type, format.colorType);
      validateHeightfieldTransparencyForColorType(
        chunk.type,
        format.colorType,
        mode === 'exact-heightfield',
      );
      transparentGraySample = await grayscaleTransparencyFromChunk(
        chunk,
        format,
        sawIdat,
        data,
        transparentGraySample,
        options.onTransparency,
      );
      density = densityFromChunk(chunk.type, sawIdat, data, density);
      if (chunk.type === 'IEND') {
        if (chunk.length !== 0) throw new Error('PNG IEND chunk must be empty.');
        if (!sawIdat) throw new Error('PNG is missing IDAT image data.');
        break;
      }
      if (isUnknownCritical(chunk.type)) {
        throw new Error(`PNG critical chunk ${chunk.type} is unsupported.`);
      }
    }
    await writer.close();
    const rowResult = await rows;
    if (!rowResult.ok) throw rowResult.error;
    return {
      kind: 'ok',
      width: source.width,
      height: source.height,
      sampledWidth: target.width,
      sampledHeight: target.height,
      bitDepth: format.bitDepth,
      colorType: format.colorType,
      density,
    };
  } catch (error) {
    await writer.abort(error).catch(() => undefined);
    await rows;
    throw error;
  }
}

type SettledRows = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

function settledRows(rows: Promise<void>): Promise<SettledRows> {
  return rows.then(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error }),
  );
}

function densityFromChunk(
  type: string,
  afterImageData: boolean,
  bytes: Uint8Array,
  current: ImageDensity | null,
): ImageDensity | null {
  return type === 'pHYs' && !afterImageData ? pngDensity(bytes) : current;
}

function pngDensity(bytes: Uint8Array): ImageDensity | null {
  if (bytes.byteLength !== 9 || bytes[8] !== 1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const xDpi = normalizeImageDensity(Math.round(view.getUint32(0) * 0.0254));
  const yDpi = normalizeImageDensity(Math.round(view.getUint32(4) * 0.0254));
  return xDpi === null || yDpi === null ? null : { xDpi, yDpi };
}
type PngHeader = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly compression: number;
  readonly filter: number;
  readonly interlace: number;
};

type ChunkHeader = {
  readonly length: number;
  readonly type: string;
  readonly typeBytes: Uint8Array;
};

async function readChunkHeader(reader: PngStreamReader): Promise<ChunkHeader> {
  const length = await reader.readUint32();
  const typeBytes = await reader.readExact(4);
  const type = String.fromCharCode(...typeBytes);
  if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('PNG chunk type is invalid.');
  return { length, type, typeBytes };
}

async function readChunkData(
  reader: PngStreamReader,
  chunk: ChunkHeader,
  visit: (segment: Uint8Array) => void | Promise<void> = () => undefined,
): Promise<Uint8Array> {
  const retained = chunk.length <= 13 ? new Uint8Array(chunk.length) : new Uint8Array();
  let retainedOffset = 0;
  let crc = startPngCrc(chunk.typeBytes);
  await reader.readSegments(chunk.length, async (segment) => {
    crc = updatePngCrc(crc, segment);
    if (retained.length > 0) {
      retained.set(segment, retainedOffset);
      retainedOffset += segment.length;
    }
    await visit(segment);
  });
  const expected = await reader.readUint32();
  const actual = finishPngCrc(crc);
  if (actual !== expected) throw new Error(`PNG ${chunk.type} CRC mismatch.`);
  return retained;
}

function parseHeader(bytes: Uint8Array): PngHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  if (width === 0 || height === 0)
    throw new Error(`PNG dimensions are invalid: ${width}x${height}.`);
  return {
    width,
    height,
    bitDepth: bytes[8] ?? 0,
    colorType: bytes[9] ?? 0,
    compression: bytes[10] ?? 0,
    filter: bytes[11] ?? 0,
    interlace: bytes[12] ?? 0,
  };
}

function assertSignature(actual: Uint8Array): void {
  if (actual.some((byte, index) => byte !== SIGNATURE[index])) {
    throw new Error('PNG signature is invalid.');
  }
}

function isUnknownCritical(type: string): boolean {
  return !['PLTE', 'IDAT', 'IEND'].includes(type) && type[0] === type[0]?.toUpperCase();
}

function assertPositiveBudget(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function streamBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return bytes.slice() as Uint8Array<ArrayBuffer>;
}
