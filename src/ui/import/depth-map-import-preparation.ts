import { createReliefHeightfield } from '../../core/relief/relief-heightfield-factory';
import type { ReliefDepthMap, ReliefHeightfield } from '../../core/scene/relief';
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

/** Canonical U16 relief field prepared entirely inside the import worker. */
export type PreparedReliefHeightfieldImportResult =
  | { readonly kind: 'ok'; readonly heightfield: ReliefHeightfield }
  | { readonly kind: 'error'; readonly reason: string };

/** Cancellation and encoded-byte progress callbacks for one PNG preparation request. */
export type DepthMapImportPreparationOptions = {
  readonly signal?: AbortSignal;
  readonly onProgress?: (encodedBytes: number) => void;
};

export type ReliefHeightfieldImportPreparationOptions = DepthMapImportPreparationOptions & {
  readonly sourceName: string;
  readonly physicalWidthMm: number;
  readonly maxDepthMm: number;
  readonly onPreparing?: () => void;
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

/** Decode and bind the durable U16 field without a UI-thread decode/expand/re-encode pass. */
export async function prepareReliefHeightfieldPng(
  blob: Blob,
  options: ReliefHeightfieldImportPreparationOptions,
): Promise<PreparedReliefHeightfieldImportResult> {
  if (!positiveFinite(options.physicalWidthMm) || !positiveFinite(options.maxDepthMm)) {
    return {
      kind: 'error',
      reason: 'Height-map physical width and maximum depth must be finite and positive.',
    };
  }
  const accumulator = createU16SampleAccumulator();
  let transparentGraySample: number | undefined;
  const decoded = await decodeIncrementalPngToLuma(blob.stream(), {
    maxEdge: Number.MAX_SAFE_INTEGER,
    maxPixels: Number.MAX_SAFE_INTEGER,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: ({ encodedBytes }) => options.onProgress?.(encodedBytes) }),
    onHeader: accumulator.acceptHeader,
    onTransparency: ({ sample }) => {
      transparentGraySample = sample;
    },
    onRow: accumulator.acceptRow,
  });
  if (decoded.kind === 'legacy-fallback') {
    return { kind: 'error', reason: decoded.reason };
  }
  const samples = accumulator.complete();
  if (samples === null) {
    return { kind: 'error', reason: 'Height-map PNG did not produce its declared samples.' };
  }
  const physicalHeightMm = options.physicalWidthMm * (decoded.height / decoded.width);
  if (!Number.isFinite(physicalHeightMm) || !(physicalHeightMm > 0)) {
    return { kind: 'error', reason: 'Height-map physical dimensions are not finite and positive.' };
  }
  options.onPreparing?.();
  if (options.signal?.aborted === true) throw abortError();
  return {
    kind: 'ok',
    heightfield: createReliefHeightfield({
      width: decoded.width,
      height: decoded.height,
      physicalWidthMm: options.physicalWidthMm,
      physicalHeightMm,
      samples,
      ...inclusionMaskInput(samples, transparentGraySample),
      mapping: {
        polarity: 'light-is-high',
        inputLowCode: 0,
        inputHighCode: 0xffff,
        curve: { kind: 'gamma-v1', gamma: 1 },
        maxDepthMm: options.maxDepthMm,
        crop: { kind: 'normalized-v1', x: 0, y: 0, width: 1, height: 1 },
        aspect: 'preserve',
        inclusionThreshold: 255,
        outsideMask: 'excluded',
      },
      provenance: {
        sourceKind: 'depth-map',
        sourceName: options.sourceName,
        sourceBitDepth: 8,
        sourcePolarity: 'light-is-high',
      },
    }),
  };
}

function inclusionMaskInput(
  samples: Uint8Array,
  transparentSample: number | undefined,
): { readonly inclusionMask?: Uint8Array } {
  return transparentSample === undefined
    ? {}
    : { inclusionMask: inclusionMaskForTransparentGray(samples, transparentSample) };
}

function inclusionMaskForTransparentGray(
  samples: Uint8Array,
  transparentSample: number,
): Uint8Array {
  const sampleCount = samples.byteLength / 2;
  let mask: Uint8Array;
  try {
    mask = new Uint8Array(sampleCount);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error('Canonical height-map inclusion mask does not fit in this runtime.');
    }
    throw error;
  }
  mask.fill(0xff);
  for (let index = 0; index < sampleCount; index += 1) {
    if (samples[index * 2] === transparentSample && samples[index * 2 + 1] === transparentSample) {
      mask[index] = 0;
    }
  }
  return mask;
}

type SampleAccumulator = {
  readonly acceptHeader: (header: IncrementalPngHeaderResult) => void;
  readonly acceptRow: (row: Uint8Array) => void;
  readonly complete: () => Uint8Array | null;
};

type U16SampleAccumulator = {
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

function createU16SampleAccumulator(): U16SampleAccumulator {
  let samples: Uint8Array | null = null;
  let sampleOffset = 0;
  return {
    acceptHeader: (header) => {
      samples = allocateU16Samples(header);
    },
    acceptRow: (row) => {
      if (samples === null || (sampleOffset + row.length) * 2 > samples.length) {
        throw new Error('Height-map PNG produced inconsistent sample rows.');
      }
      for (const value of row) {
        samples[sampleOffset * 2] = value;
        samples[sampleOffset * 2 + 1] = value;
        sampleOffset += 1;
      }
    },
    complete: () => (samples !== null && sampleOffset * 2 === samples.length ? samples : null),
  };
}

function allocateSamples(header: IncrementalPngHeaderResult): Uint8Array {
  validateHeader(header);
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

function allocateU16Samples(header: IncrementalPngHeaderResult): Uint8Array {
  validateHeader(header);
  const outputBytes = header.width * header.height * 2;
  if (!Number.isSafeInteger(outputBytes)) {
    throw new Error('Canonical height-map sample bytes exceed the exact numeric range.');
  }
  try {
    return new Uint8Array(outputBytes);
  } catch {
    throw new Error('Canonical height-map samples do not fit in this runtime.');
  }
}

function validateHeader(header: IncrementalPngHeaderResult): void {
  if (header.bitDepth !== 8 || header.colorType !== 0) {
    throw new Error('Height maps must be non-interlaced 8-bit grayscale PNG files.');
  }
  if (header.sampledWidth !== header.width || header.sampledHeight !== header.height) {
    throw new Error('Height-map dimensions exceed the exact sample range.');
  }
}

function abortError(): Error {
  const error = new Error('height-map preparation cancelled');
  error.name = 'AbortError';
  return error;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
