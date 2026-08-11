import {
  canonicalBase64ByteLength,
  decodeCanonicalBase64,
  type Base64DecodeResult,
} from './depth-map-base64';
import { reliefHeightfieldDigest } from './heightfield-digest';
import { heightfieldMetadataError } from './heightfield-metadata-validator';
import { DEFAULT_HEIGHTMAP_CELL_MM, heightmapCellSize, type Heightmap } from './heightmap';
import type { ReliefHeightfield } from '../scene/relief';

export type HeightfieldHeightmapOptions = {
  readonly targetWidthMm: number;
  readonly reliefDepthMm: number;
  readonly mmPerCell?: number;
  readonly targetScaleX?: number;
  readonly targetScaleY?: number;
};

export type HeightfieldMaterializationRuntime = {
  readonly decodeBase64: (value: string) => Base64DecodeResult;
  readonly digest: typeof reliefHeightfieldDigest;
  readonly allocateFloat32?: (length: number) => Float32Array;
  readonly allocateUint8?: (length: number) => Uint8Array;
};

const allocateFloat32 = (length: number): Float32Array => new Float32Array(length);
const allocateUint8 = (length: number): Uint8Array => new Uint8Array(length);

const DEFAULT_RUNTIME: HeightfieldMaterializationRuntime = {
  decodeBase64: decodeCanonicalBase64,
  digest: reliefHeightfieldDigest,
  allocateFloat32,
  allocateUint8,
};

export type HeightfieldHeightmapResult =
  | {
      readonly kind: 'ok';
      readonly heightmap: Heightmap;
      readonly widthMm: number;
      readonly heightMm: number;
    }
  | { readonly kind: 'error'; readonly reason: string };

/** Resolve one validated scalar field and mapping into the shared CAM heightmap. */
export function heightfieldToHeightmap(
  source: ReliefHeightfield,
  options: HeightfieldHeightmapOptions,
  runtime: HeightfieldMaterializationRuntime = DEFAULT_RUNTIME,
): HeightfieldHeightmapResult {
  const metadataError = heightfieldMetadataError(source, options);
  if (metadataError !== null) return { kind: 'error', reason: metadataError };
  const decoded = decodedHeightfield(source, runtime);
  if (decoded.kind === 'error') return decoded;
  const target = heightfieldTarget(source, options);
  if (target.kind === 'error') return target;
  const size = heightmapCellSize(
    target.widthMm,
    target.heightMm,
    options.mmPerCell ?? DEFAULT_HEIGHTMAP_CELL_MM,
  );
  if (size.kind === 'error') return size;
  const widthCells = Math.max(1, Math.ceil(target.widthMm / size.mmPerCell));
  const heightCells = Math.max(1, Math.ceil(target.heightMm / size.mmPerCell));
  const materialized = materializeHeightmap(
    source,
    decoded,
    widthCells,
    heightCells,
    size.mmPerCell,
    runtime,
  );
  if (materialized.kind === 'allocation-error') {
    return { kind: 'error', reason: 'Relief heightfield does not fit in this runtime.' };
  }
  if (materialized.kind === 'sample-error') {
    return {
      kind: 'error',
      reason: 'Relief heightfield samples must materialize to finite Float32 depths.',
    };
  }
  return {
    kind: 'ok',
    heightmap: materialized.heightmap,
    widthMm: target.widthMm,
    heightMm: target.heightMm,
  };
}

type DecodedHeightfield = {
  readonly kind: 'ok';
  readonly samples: Uint8Array;
  readonly mask?: Uint8Array;
};

function decodedHeightfield(
  source: ReliefHeightfield,
  runtime: HeightfieldMaterializationRuntime,
): DecodedHeightfield | { readonly kind: 'error'; readonly reason: string } {
  const sampleCount = source.width * source.height;
  const expectedBytes = sampleCount * 2;
  if (!Number.isSafeInteger(sampleCount) || !Number.isSafeInteger(expectedBytes)) {
    return {
      kind: 'error',
      reason: 'Relief heightfield sample count exceeds the exact numeric range.',
    };
  }
  if (canonicalBase64ByteLength(source.samplesBase64) !== expectedBytes) {
    return {
      kind: 'error',
      reason: 'Relief heightfield payload length is invalid or its base64 is malformed.',
    };
  }
  const decoded = decodePayload(source.samplesBase64, runtime);
  if (decoded.kind === 'error') {
    return {
      kind: 'error',
      reason:
        decoded.code === 'allocation'
          ? 'Relief heightfield sample payload does not fit in this runtime.'
          : 'Relief heightfield payload length is invalid or its base64 is malformed.',
    };
  }
  const maskResult = decodedMask(source, sampleCount, runtime);
  if (typeof maskResult === 'string') return { kind: 'error', reason: maskResult };
  let digest: `sha256:${string}`;
  try {
    digest = runtime.digest({
      width: source.width,
      height: source.height,
      samples: decoded.bytes,
      ...(maskResult === undefined
        ? {}
        : { inclusionMask: { encoding: 'u8-base64-v1' as const, samples: maskResult } }),
    });
  } catch (error) {
    if (isRangeError(error)) {
      return { kind: 'error', reason: 'Relief heightfield digest does not fit in this runtime.' };
    }
    throw error;
  }
  return digest === source.digest
    ? {
        kind: 'ok',
        samples: decoded.bytes,
        ...(maskResult === undefined ? {} : { mask: maskResult }),
      }
    : { kind: 'error', reason: 'Relief heightfield digest does not match its payload.' };
}

function decodedMask(
  source: ReliefHeightfield,
  sampleCount: number,
  runtime: HeightfieldMaterializationRuntime,
): Uint8Array | string | undefined {
  if (source.inclusionMask === undefined) return undefined;
  const mask = record(source.inclusionMask);
  if (mask === null || mask['encoding'] !== 'u8-base64-v1') {
    return 'Relief heightfield mask encoding is unsupported.';
  }
  if (typeof mask['samplesBase64'] !== 'string') {
    return 'Relief heightfield mask payload must be base64 text.';
  }
  if (canonicalBase64ByteLength(mask['samplesBase64']) !== sampleCount) {
    return 'Relief heightfield mask is malformed or has the wrong length.';
  }
  const decoded = decodePayload(mask['samplesBase64'], runtime);
  if (decoded.kind === 'ok') return decoded.bytes;
  return decoded.code === 'allocation'
    ? 'Relief heightfield mask payload does not fit in this runtime.'
    : 'Relief heightfield mask is malformed or has the wrong length.';
}

function decodePayload(
  value: string,
  runtime: HeightfieldMaterializationRuntime,
): Base64DecodeResult {
  try {
    return runtime.decodeBase64(value);
  } catch (error) {
    if (isRangeError(error)) {
      return {
        kind: 'error',
        code: 'allocation',
        reason: 'Base64 payload does not fit in this runtime.',
      };
    }
    throw error;
  }
}

function isRangeError(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  if (Object.prototype.toString.call(error) !== '[object Error]') return false;
  const constructor = (error as { readonly constructor?: unknown }).constructor;
  return typeof constructor === 'function' && constructor.name === 'RangeError';
}

type HeightfieldTargetResult =
  | { readonly kind: 'ok'; readonly widthMm: number; readonly heightMm: number }
  | { readonly kind: 'error'; readonly reason: string };

function heightfieldTarget(
  source: ReliefHeightfield,
  options: HeightfieldHeightmapOptions,
): HeightfieldTargetResult {
  const targetScaleX = options.targetScaleX ?? 1;
  const targetScaleY = options.targetScaleY ?? 1;
  if (!positiveFinite(targetScaleX)) {
    return { kind: 'error', reason: 'Target X scale must be finite and positive.' };
  }
  if (!positiveFinite(targetScaleY)) {
    return { kind: 'error', reason: 'Target Y scale must be finite and positive.' };
  }
  return {
    kind: 'ok',
    widthMm: source.physicalWidthMm * targetScaleX,
    heightMm: source.physicalHeightMm * targetScaleY,
  };
}

type MaterializedHeightmapResult =
  | { readonly kind: 'ok'; readonly heightmap: Heightmap }
  | { readonly kind: 'allocation-error' }
  | { readonly kind: 'sample-error' };

function materializeHeightmap(
  source: ReliefHeightfield,
  decoded: DecodedHeightfield,
  widthCells: number,
  heightCells: number,
  mmPerCell: number,
  runtime: HeightfieldMaterializationRuntime,
): MaterializedHeightmapResult {
  const cellCount = widthCells * heightCells;
  const depth = allocateTypedArray(runtime.allocateFloat32 ?? allocateFloat32, cellCount);
  if (depth === null) return { kind: 'allocation-error' };
  const tracksExclusion = decoded.mask !== undefined && source.mapping.outsideMask === 'excluded';
  const inclusion = tracksExclusion
    ? allocateTypedArray(runtime.allocateUint8 ?? allocateUint8, cellCount)
    : undefined;
  if (inclusion === null) return { kind: 'allocation-error' };
  for (let y = 0; y < heightCells; y += 1) {
    for (let x = 0; x < widthCells; x += 1) {
      const targetIndex = y * widthCells + x;
      const sampled = sampleTargetCell(source, decoded, x, y, widthCells, heightCells);
      if (!storeMaterializedCell(depth, inclusion, targetIndex, sampled)) {
        return { kind: 'sample-error' };
      }
    }
  }
  return {
    kind: 'ok',
    heightmap: {
      widthCells,
      heightCells,
      mmPerCell,
      depth,
      ...(inclusion === undefined ? {} : { inclusion }),
    },
  };
}

function storeMaterializedCell(
  depth: Float32Array,
  inclusion: Uint8Array | undefined,
  targetIndex: number,
  sampled: { readonly included: boolean; readonly depth: number },
): boolean {
  depth[targetIndex] = sampled.depth;
  if (!Number.isFinite(depth[targetIndex])) return false;
  if (inclusion !== undefined && sampled.included) inclusion[targetIndex] = 1;
  return true;
}

function allocateTypedArray<T extends { readonly length: number }>(
  allocator: (length: number) => T,
  length: number,
): T | null {
  try {
    const allocated = allocator(length);
    return allocated.length === length ? allocated : null;
  } catch (error) {
    if (isRangeError(error)) return null;
    throw error;
  }
}

function sampleTargetCell(
  source: ReliefHeightfield,
  decoded: DecodedHeightfield,
  x: number,
  y: number,
  widthCells: number,
  heightCells: number,
): { readonly included: boolean; readonly depth: number } {
  const rangeX = sourceRange(
    source.mapping.crop.x,
    source.mapping.crop.width,
    source.width,
    x,
    widthCells,
  );
  const rangeY = sourceRange(
    source.mapping.crop.y,
    source.mapping.crop.height,
    source.height,
    y,
    heightCells,
  );
  let included = false;
  let surface = Number.NEGATIVE_INFINITY;
  for (let sy = rangeY.min; sy <= rangeY.max; sy += 1) {
    for (let sx = rangeX.min; sx <= rangeX.max; sx += 1) {
      const sample = mappedDepth(source, decoded, sx, sy);
      // One coarse CAM cell represents its whole overlapping source footprint.
      // It is carveable only when that entire footprint is included; otherwise
      // resampling would expand an excluded source pixel into tool-center access.
      if (!sample.included) return { included: false, depth: 0 };
      included = true;
      surface = Math.max(surface, sample.depth);
    }
  }
  return included ? { included: true, depth: surface } : { included: false, depth: 0 };
}

function sourceRange(
  cropStart: number,
  cropSize: number,
  sourceSize: number,
  targetIndex: number,
  targetSize: number,
): { readonly min: number; readonly max: number } {
  const start = (cropStart + (targetIndex / targetSize) * cropSize) * sourceSize;
  const end = (cropStart + ((targetIndex + 1) / targetSize) * cropSize) * sourceSize;
  const min = Math.min(sourceSize - 1, Math.floor(start));
  const max = Math.min(sourceSize - 1, Math.max(min, Math.ceil(end) - 1));
  return { min, max };
}

function mappedDepth(
  source: ReliefHeightfield,
  decoded: DecodedHeightfield,
  x: number,
  y: number,
): { readonly included: boolean; readonly depth: number } {
  const index = y * source.width + x;
  const mask = decoded.mask?.[index];
  if (mask !== undefined && mask < source.mapping.inclusionThreshold) {
    if (source.mapping.outsideMask === 'excluded') return { included: false, depth: 0 };
    return {
      included: true,
      depth: source.mapping.outsideMask === 'stock-top' ? 0 : -source.mapping.maxDepthMm,
    };
  }
  const code = (decoded.samples[index * 2] ?? 0) | ((decoded.samples[index * 2 + 1] ?? 0) << 8);
  const normalized = mappedUnitCode(
    code,
    source.mapping.inputLowCode,
    source.mapping.inputHighCode,
  );
  const curved = normalized ** source.mapping.curve.gamma;
  const height = source.mapping.polarity === 'light-is-high' ? curved : 1 - curved;
  const depth = -source.mapping.maxDepthMm * (1 - height);
  return { included: true, depth: depth === 0 ? 0 : depth };
}

function mappedUnitCode(code: number, low: number, high: number): number {
  if (low === high) return 0.5;
  return Math.min(1, Math.max(0, (code - low) / (high - low)));
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
