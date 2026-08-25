// Deep imports: core/relief's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import {
  canonicalBase64ByteLength,
  decodeCanonicalBase64,
  encodeCanonicalBase64,
  type Base64DecodeResult,
} from '../../core/relief/depth-map-base64';
import { reliefHeightfieldDigest } from '../../core/relief/heightfield-digest';
import type { ReliefHeightfield } from '../../core/scene/relief';
import { isMigrationFailure, migrationFailure, type MigrationFailure } from './migration-failure';

type RawProject = Record<string, unknown>;

export type ReliefMigrationRuntime = {
  readonly decodeBase64: (value: string) => Base64DecodeResult;
  readonly allocateBytes: (byteLength: number) => Uint8Array;
  readonly encodeBase64: typeof encodeCanonicalBase64;
  readonly digest: typeof reliefHeightfieldDigest;
};

const DEFAULT_RUNTIME: ReliefMigrationRuntime = {
  decodeBase64: decodeCanonicalBase64,
  allocateBytes: (byteLength) => new Uint8Array(byteLength),
  encodeBase64: encodeCanonicalBase64,
  digest: reliefHeightfieldDigest,
};

/** Migrate v3 relief source fields into the discriminated v4 source union. */
export function migrateV3ReliefSources(
  raw: RawProject,
  runtime: ReliefMigrationRuntime = DEFAULT_RUNTIME,
): RawProject | MigrationFailure {
  const scene = record(raw['scene']);
  if (scene === null || !Array.isArray(scene['objects'])) return { ...raw, schemaVersion: 4 };
  const objects: unknown[] = [];
  for (let index = 0; index < scene['objects'].length; index += 1) {
    const migrated = migrateReliefObject(
      scene['objects'][index],
      `scene.objects[${index}]`,
      runtime,
    );
    if (isMigrationFailure(migrated)) return migrated;
    objects.push(migrated);
  }
  return {
    ...raw,
    schemaVersion: 4,
    scene: { ...scene, objects },
  };
}

function migrateReliefObject(
  value: unknown,
  path: string,
  runtime: ReliefMigrationRuntime,
): unknown | MigrationFailure {
  const object = record(value);
  if (object === null || object['kind'] !== 'relief') return value;
  const hasCurrentSource = object['reliefSource'] !== undefined;
  const hasDepthMap = object['depthMap'] !== undefined;
  const hasMeshSource = object['meshPositions'] !== undefined || object['emptyCells'] !== undefined;
  // An ambiguous v3 object was invalid before migration and must not become valid
  // merely because one branch happened to win dispatch order.
  if (hasCurrentSource && (hasDepthMap || hasMeshSource)) return value;
  if (hasDepthMap && hasMeshSource) return value;
  if (hasDepthMap) return migrateDepthMapRelief(object, path, runtime);
  if (hasMeshSource) {
    const { meshPositions, emptyCells, ...common } = object;
    return {
      ...common,
      reliefSource: { kind: 'legacy-mesh', meshPositions, emptyCells },
    };
  }
  return value;
}

function migrateDepthMapRelief(
  object: Record<string, unknown>,
  path: string,
  runtime: ReliefMigrationRuntime,
): unknown | MigrationFailure {
  const depthMap = record(object['depthMap']);
  const converted =
    depthMap === null ? null : convertDepthMap(object, depthMap, `${path}.depthMap`, runtime);
  if (isMigrationFailure(converted)) return converted;
  if (converted === null) return object;
  const { depthMap: _depthMap, meshPositions: _mesh, emptyCells: _empty, ...common } = object;
  return { ...common, reliefSource: converted };
}

function convertDepthMap(
  object: Record<string, unknown>,
  depthMap: Record<string, unknown>,
  path: string,
  runtime: ReliefMigrationRuntime,
): ReliefHeightfield | MigrationFailure | null {
  const metadata = legacyDepthMapMetadata(object, depthMap);
  if (metadata === null) return null;
  const { dimensions, bitDepth, samplesBase64 } = metadata;
  const expectedBytes = dimensions.sampleCount * (bitDepth / 8);
  if (
    !Number.isSafeInteger(expectedBytes) ||
    canonicalBase64ByteLength(samplesBase64) !== expectedBytes
  ) {
    return null;
  }
  const decoded = runtime.decodeBase64(samplesBase64);
  if (decoded.kind === 'error') {
    return decoded.code === 'allocation' ? allocationFailure(`${path}.samplesBase64`) : null;
  }
  const samples = convertSamples(
    decoded.bytes,
    dimensions.sampleCount,
    bitDepth,
    `${path}.samplesBase64`,
    runtime,
  );
  if (isMigrationFailure(samples)) return samples;
  if (samples === null) return null;
  return canonicalHeightfield(
    metadata,
    samples,
    path.replace(/\.depthMap$/, '.reliefSource'),
    runtime,
  );
}

type LegacyDepthMapMetadata = {
  readonly dimensions: LegacyDimensions;
  readonly bitDepth: 8 | 16;
  readonly polarity: 'light-is-high' | 'light-is-deep';
  readonly samplesBase64: string;
  readonly sourceName: string;
  readonly maxDepthMm: number;
};

function legacyDepthMapMetadata(
  object: Record<string, unknown>,
  depthMap: Record<string, unknown>,
): LegacyDepthMapMetadata | null {
  const dimensions = legacyDimensions(object, depthMap);
  const bitDepth = depthMap['bitDepth'];
  const polarity = depthMap['polarity'];
  const samplesBase64 = depthMap['samplesBase64'];
  const sourceName = object['source'];
  const maxDepthMm = object['reliefDepthMm'];
  if (
    dimensions === null ||
    (bitDepth !== 8 && bitDepth !== 16) ||
    (polarity !== 'light-is-high' && polarity !== 'light-is-deep') ||
    typeof samplesBase64 !== 'string' ||
    typeof sourceName !== 'string' ||
    !positiveFinite(maxDepthMm)
  ) {
    return null;
  }
  return { dimensions, bitDepth, polarity, samplesBase64, sourceName, maxDepthMm };
}

function canonicalHeightfield(
  metadata: LegacyDepthMapMetadata,
  samples: Uint8Array,
  path: string,
  runtime: ReliefMigrationRuntime,
): ReliefHeightfield | MigrationFailure {
  const { dimensions, bitDepth, polarity, sourceName, maxDepthMm } = metadata;
  const samplesBase64 = allocationBoundCall(
    () => runtime.encodeBase64(samples),
    `${path}.samplesBase64`,
  );
  if (isMigrationFailure(samplesBase64)) return samplesBase64;
  const digest = allocationBoundCall(
    () =>
      runtime.digest({
        width: dimensions.width,
        height: dimensions.height,
        samples,
      }),
    `${path}.digest`,
  );
  if (isMigrationFailure(digest)) return digest;
  return {
    kind: 'heightfield-v1',
    schemaVersion: 1,
    width: dimensions.width,
    height: dimensions.height,
    physicalWidthMm: dimensions.physicalWidthMm,
    physicalHeightMm: dimensions.physicalHeightMm,
    encoding: 'u16le-base64-v1',
    samplesBase64,
    mapping: {
      polarity,
      inputLowCode: 0,
      inputHighCode: 0xffff,
      curve: { kind: 'gamma-v1', gamma: 1 },
      maxDepthMm,
      crop: { kind: 'normalized-v1', x: 0, y: 0, width: 1, height: 1 },
      aspect: 'preserve',
      inclusionThreshold: 255,
      outsideMask: 'excluded',
    },
    provenance: {
      sourceKind: 'depth-map',
      sourceName,
      sourceBitDepth: bitDepth,
      sourcePolarity: polarity,
    },
    algorithmRevision: 'heightfield-map-v1',
    revision: 0,
    digest,
  };
}

type LegacyDimensions = {
  readonly width: number;
  readonly height: number;
  readonly sampleCount: number;
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
};

function legacyDimensions(
  object: Record<string, unknown>,
  depthMap: Record<string, unknown>,
): LegacyDimensions | null {
  const width = depthMap['width'];
  const height = depthMap['height'];
  const physicalWidthMm = object['targetWidthMm'];
  if (
    !positiveSafeInteger(width) ||
    !positiveSafeInteger(height) ||
    !positiveFinite(physicalWidthMm)
  ) {
    return null;
  }
  const sampleCount = width * height;
  const physicalHeightMm = physicalWidthMm * (height / width);
  if (!Number.isSafeInteger(sampleCount) || !positiveFinite(physicalHeightMm)) return null;
  return { width, height, sampleCount, physicalWidthMm, physicalHeightMm };
}

function convertSamples(
  bytes: Uint8Array,
  sampleCount: number,
  bitDepth: 8 | 16,
  path: string,
  runtime: ReliefMigrationRuntime,
): Uint8Array | MigrationFailure | null {
  const expectedBytes = sampleCount * (bitDepth / 8);
  if (!Number.isSafeInteger(expectedBytes) || bytes.byteLength !== expectedBytes) return null;
  let converted: Uint8Array;
  try {
    converted = runtime.allocateBytes(sampleCount * 2);
  } catch (error) {
    if (error instanceof RangeError) return allocationFailure(path);
    throw error;
  }
  if (converted.byteLength !== sampleCount * 2) return null;
  for (let index = 0; index < sampleCount; index += 1) {
    if (bitDepth === 8) {
      const value = bytes[index] ?? 0;
      converted[index * 2] = value;
      converted[index * 2 + 1] = value;
    } else {
      converted[index * 2] = bytes[index * 2 + 1] ?? 0;
      converted[index * 2 + 1] = bytes[index * 2] ?? 0;
    }
  }
  return converted;
}

function allocationBoundCall<T>(operation: () => T, path: string): T | MigrationFailure {
  try {
    return operation();
  } catch (error) {
    if (error instanceof RangeError) return allocationFailure(path);
    throw error;
  }
}

function allocationFailure(path: string): MigrationFailure {
  return migrationFailure(`allocation failed for \`${path}\` during schema-v4 migration`);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
