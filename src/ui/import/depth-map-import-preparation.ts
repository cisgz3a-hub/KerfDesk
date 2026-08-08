import type { ReliefObject } from '../../core/scene';
import { bytesToBase64 } from './base64-bytes';
import { decodeIncrementalPngToLuma } from './png-incremental-decoder';

type ReliefDepthMap = NonNullable<ReliefObject['depthMap']>;

export type PreparedDepthMapImportResult =
  | {
      readonly kind: 'ok';
      readonly depthMap: ReliefDepthMap;
    }
  | { readonly kind: 'error'; readonly reason: string };

export type DepthMapImportPreparationOptions = {
  readonly signal?: AbortSignal;
  readonly onProgress?: (encodedBytes: number) => void;
};

/** Decode one exact grayscale sample per PNG pixel; never resample or infer depth. */
export async function prepareDepthMapPng(
  blob: Blob,
  options: DepthMapImportPreparationOptions = {},
): Promise<PreparedDepthMapImportResult> {
  const state: { samples: Uint8Array | null; rowOffset: number } = {
    samples: null,
    rowOffset: 0,
  };
  const decoded = await decodeIncrementalPngToLuma(blob.stream(), {
    maxEdge: Number.MAX_SAFE_INTEGER,
    maxPixels: Number.MAX_SAFE_INTEGER,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: ({ encodedBytes }) => options.onProgress?.(encodedBytes) }),
    onHeader: (header) => {
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
        state.samples = new Uint8Array(sampleCount);
      } catch {
        throw new Error('Height-map samples do not fit in this runtime.');
      }
    },
    onRow: (row) => {
      if (state.samples === null || state.rowOffset + row.length > state.samples.length) {
        throw new Error('Height-map PNG produced inconsistent sample rows.');
      }
      state.samples.set(row, state.rowOffset);
      state.rowOffset += row.length;
    },
  });
  if (decoded.kind === 'legacy-fallback') {
    return { kind: 'error', reason: decoded.reason };
  }
  if (state.samples === null || state.rowOffset !== state.samples.length) {
    return { kind: 'error', reason: 'Height-map PNG did not produce its declared samples.' };
  }
  return {
    kind: 'ok',
    depthMap: {
      schemaVersion: 1,
      width: decoded.width,
      height: decoded.height,
      bitDepth: 8,
      samplesBase64: bytesToBase64(state.samples),
      polarity: 'light-is-high',
    },
  };
}
