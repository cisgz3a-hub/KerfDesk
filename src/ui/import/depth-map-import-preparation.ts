import type { ReliefDepthMap } from '../../core/scene/relief';
import { bytesToBase64 } from './base64-bytes';
import {
  decodeIncrementalPngToLuma,
  type IncrementalPngHeaderResult,
} from './png-incremental-decoder';

/** Prepared durable depth-map samples, or the reason exact preparation was unavailable. */
export type PreparedDepthMapImportResult =
  | {
      readonly kind: 'ok';
      readonly depthMap: ReliefDepthMap;
    }
  | { readonly kind: 'error'; readonly reason: string };

/** Cancellation and encoded-byte progress callbacks for one PNG preparation request. */
export type DepthMapImportPreparationOptions = {
  readonly signal?: AbortSignal;
  readonly onProgress?: (encodedBytes: number) => void;
};

/** Decode one exact grayscale sample per PNG pixel; never resample or infer depth. */
export async function prepareDepthMapPng(
  blob: Blob,
  options: DepthMapImportPreparationOptions = {},
): Promise<PreparedDepthMapImportResult> {
  const accumulator = createSampleAccumulator();
  const decoded = await decodeIncrementalPngToLuma(blob.stream(), {
    maxEdge: Number.MAX_SAFE_INTEGER,
    maxPixels: Number.MAX_SAFE_INTEGER,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: ({ encodedBytes }) => options.onProgress?.(encodedBytes) }),
    onHeader: accumulator.acceptHeader,
    onRow: accumulator.acceptRow,
  });
  if (decoded.kind === 'legacy-fallback') {
    return { kind: 'error', reason: decoded.reason };
  }
  const samples = accumulator.complete();
  if (samples === null) {
    return { kind: 'error', reason: 'Height-map PNG did not produce its declared samples.' };
  }
  return {
    kind: 'ok',
    depthMap: {
      schemaVersion: 1,
      width: decoded.width,
      height: decoded.height,
      bitDepth: 8,
      samplesBase64: bytesToBase64(samples),
      polarity: 'light-is-high',
    },
  };
}

type SampleAccumulator = {
  readonly acceptHeader: (header: IncrementalPngHeaderResult) => void;
  readonly acceptRow: (row: Uint8Array) => void;
  readonly complete: () => Uint8Array | null;
};

function createSampleAccumulator(): SampleAccumulator {
  let samples: Uint8Array | null = null;
  let rowOffset = 0;
  return {
    acceptHeader: (header) => {
      samples = allocateSamples(header);
    },
    acceptRow: (row) => {
      if (samples === null || rowOffset + row.length > samples.length) {
        throw new Error('Height-map PNG produced inconsistent sample rows.');
      }
      samples.set(row, rowOffset);
      rowOffset += row.length;
    },
    complete: () => (samples !== null && rowOffset === samples.length ? samples : null),
  };
}

function allocateSamples(header: IncrementalPngHeaderResult): Uint8Array {
  if (header.bitDepth !== 8 || header.colorType !== 0) {
    throw new Error('Height maps must be non-interlaced 8-bit grayscale PNG files.');
  }
  if (header.sampledWidth !== header.width || header.sampledHeight !== header.height) {
    throw new Error('Height-map dimensions exceed the exact sample range.');
  }
  const sampleCount = header.width * header.height;
  if (!Number.isSafeInteger(sampleCount)) {
    throw new Error('Height-map sample count exceeds the exact numeric range.');
  }
  try {
    return new Uint8Array(sampleCount);
  } catch {
    throw new Error('Height-map samples do not fit in this runtime.');
  }
}
