import type { ReliefObject } from '../scene';
import { decodeCanonicalBase64 } from './depth-map-base64';
import { DEFAULT_HEIGHTMAP_CELL_MM, heightmapCellSize, type Heightmap } from './heightmap';

type ReliefDepthMap = NonNullable<ReliefObject['depthMap']>;

export type DepthMapHeightmapOptions = {
  readonly targetWidthMm: number;
  readonly reliefDepthMm: number;
  readonly mmPerCell?: number;
  readonly targetScaleX?: number;
  readonly targetScaleY?: number;
};

export type DepthMapHeightmapResult =
  | {
      readonly kind: 'ok';
      readonly heightmap: Heightmap;
      readonly widthMm: number;
      readonly heightMm: number;
    }
  | { readonly kind: 'error'; readonly reason: string };

export function depthMapToHeightmap(
  source: ReliefDepthMap,
  options: DepthMapHeightmapOptions,
): DepthMapHeightmapResult {
  const metadataError = depthMapMetadataError(source);
  if (metadataError !== null) return { kind: 'error', reason: metadataError };
  const target = depthMapTarget(source, options);
  if (target.kind === 'error') return target;
  const samples = decodedDepthMapSamples(source);
  if (samples.kind === 'error') return samples;
  const size = heightmapCellSize(
    target.widthMm,
    target.heightMm,
    options.mmPerCell ?? DEFAULT_HEIGHTMAP_CELL_MM,
  );
  if (size.kind === 'error') return size;
  const widthCells = Math.max(1, Math.ceil(target.widthMm / size.mmPerCell));
  const heightCells = Math.max(1, Math.ceil(target.heightMm / size.mmPerCell));
  let depth: Float32Array;
  try {
    depth = materializeDepths(
      source,
      samples.bytes,
      widthCells,
      heightCells,
      options.reliefDepthMm,
    );
  } catch (error) {
    if (error instanceof RangeError) {
      return { kind: 'error', reason: 'Depth-map heightmap does not fit in this runtime.' };
    }
    throw error;
  }
  return {
    kind: 'ok',
    heightmap: { widthCells, heightCells, mmPerCell: size.mmPerCell, depth },
    widthMm: target.widthMm,
    heightMm: target.heightMm,
  };
}

type DepthMapTargetResult =
  | { readonly kind: 'ok'; readonly widthMm: number; readonly heightMm: number }
  | { readonly kind: 'error'; readonly reason: string };

function depthMapTarget(
  source: ReliefDepthMap,
  options: DepthMapHeightmapOptions,
): DepthMapTargetResult {
  if (!positiveFinite(options.targetWidthMm)) {
    return { kind: 'error', reason: 'Target width must be a finite positive number.' };
  }
  if (!positiveFinite(options.reliefDepthMm)) {
    return { kind: 'error', reason: 'Relief depth must be a finite positive number.' };
  }
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
    widthMm: options.targetWidthMm * targetScaleX,
    heightMm: options.targetWidthMm * (source.height / source.width) * targetScaleY,
  };
}

type DecodedSamplesResult =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | { readonly kind: 'error'; readonly reason: string };

function decodedDepthMapSamples(source: ReliefDepthMap): DecodedSamplesResult {
  const expectedBytes = source.width * source.height * (source.bitDepth / 8);
  if (!Number.isSafeInteger(expectedBytes)) {
    return { kind: 'error', reason: 'Depth-map sample count exceeds the exact numeric range.' };
  }
  const decoded = decodeCanonicalBase64(source.samplesBase64);
  if (decoded.kind === 'error') return decoded;
  if (decoded.bytes.length !== expectedBytes) {
    return {
      kind: 'error',
      reason: 'Depth-map payload length does not match its dimensions and bit depth.',
    };
  }
  return decoded;
}

function depthMapMetadataError(source: ReliefDepthMap): string | null {
  if (source.schemaVersion !== 1) return 'Depth-map schema version is unsupported.';
  if (source.polarity !== 'light-is-high' && source.polarity !== 'light-is-deep') {
    return 'Depth-map polarity is invalid.';
  }
  if (!positiveSafeInteger(source.width)) return 'Depth-map width must be a positive safe integer.';
  if (!positiveSafeInteger(source.height)) {
    return 'Depth-map height must be a positive safe integer.';
  }
  if (source.bitDepth !== 8 && source.bitDepth !== 16) {
    return 'Depth-map bit depth must be 8 or 16.';
  }
  if (typeof source.samplesBase64 !== 'string') {
    return 'Depth-map sample payload must be a base64 string.';
  }
  return null;
}

function materializeDepths(
  source: ReliefDepthMap,
  bytes: Uint8Array,
  widthCells: number,
  heightCells: number,
  reliefDepthMm: number,
): Float32Array {
  const output = new Float32Array(widthCells * heightCells);
  for (let y = 0; y < heightCells; y += 1) {
    const sourceMinY = Math.min(source.height - 1, Math.floor((y * source.height) / heightCells));
    const sourceMaxY = Math.min(
      source.height - 1,
      Math.max(sourceMinY, Math.ceil(((y + 1) * source.height) / heightCells) - 1),
    );
    for (let x = 0; x < widthCells; x += 1) {
      const sourceMinX = Math.min(source.width - 1, Math.floor((x * source.width) / widthCells));
      const sourceMaxX = Math.min(
        source.width - 1,
        Math.max(sourceMinX, Math.ceil(((x + 1) * source.width) / widthCells) - 1),
      );
      let surface = Number.NEGATIVE_INFINITY;
      for (let sy = sourceMinY; sy <= sourceMaxY; sy += 1) {
        for (let sx = sourceMinX; sx <= sourceMaxX; sx += 1) {
          surface = Math.max(surface, sampleDepth(source, bytes, sx, sy, reliefDepthMm));
        }
      }
      output[y * widthCells + x] = surface;
    }
  }
  return output;
}

function sampleDepth(
  source: ReliefDepthMap,
  bytes: Uint8Array,
  x: number,
  y: number,
  reliefDepthMm: number,
): number {
  const sampleIndex = y * source.width + x;
  const value =
    source.bitDepth === 8
      ? (bytes[sampleIndex] ?? 0)
      : ((bytes[sampleIndex * 2] ?? 0) << 8) | (bytes[sampleIndex * 2 + 1] ?? 0);
  const maximum = source.bitDepth === 8 ? 0xff : 0xffff;
  const normalized = value / maximum;
  const depth =
    source.polarity === 'light-is-high'
      ? -reliefDepthMm * (1 - normalized)
      : -reliefDepthMm * normalized;
  return depth === 0 ? 0 : depth;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
