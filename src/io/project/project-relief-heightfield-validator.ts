import {
  canonicalBase64ByteLength,
  decodeCanonicalBase64,
  type Base64DecodeResult,
} from '../../core/relief/depth-map-base64';
import { reliefHeightfieldDigest } from '../../core/relief/heightfield-digest';
import { isObject } from './project-shape-primitives';

const SOURCE_KINDS = [
  'depth-map',
  'brightness-emboss',
  'relative-depth-map',
  'editable-relief-map',
  'stl-top-projection',
] as const;

export type ReliefHeightfieldValidationRuntime = {
  readonly decodeBase64: (value: string) => Base64DecodeResult;
  readonly digest: typeof reliefHeightfieldDigest;
};

const DEFAULT_RUNTIME: ReliefHeightfieldValidationRuntime = {
  decodeBase64: decodeCanonicalBase64,
  digest: reliefHeightfieldDigest,
};

/** Validate a v4 heightfield source, including exact payload lengths and digest. */
export function validateReliefHeightfield(
  value: unknown,
  path: string,
  runtime: ReliefHeightfieldValidationRuntime = DEFAULT_RUNTIME,
): string | null {
  if (!isObject(value) || value['kind'] !== 'heightfield-v1') {
    return `missing or invalid \`${path}\``;
  }
  const metadataError = validateMetadata(value, path);
  if (metadataError !== null) return metadataError;
  const payload = decodePayload(value, path, runtime);
  if (typeof payload === 'string') return payload;
  let expectedDigest: `sha256:${string}`;
  try {
    expectedDigest = runtime.digest({
      width: value['width'] as number,
      height: value['height'] as number,
      samples: payload.samples,
      ...(payload.mask === undefined
        ? {}
        : { inclusionMask: { encoding: 'u8-base64-v1' as const, samples: payload.mask } }),
    });
  } catch (error) {
    if (error instanceof RangeError) return allocationError(`${path}.digest`);
    throw error;
  }
  return value['digest'] === expectedDigest ? null : `digest mismatch in \`${path}.digest\``;
}

/** Keep duplicated object dimensions/depth aligned with canonical field mapping. */
export function validateReliefHeightfieldBounds(
  object: Record<string, unknown>,
  path: string,
): string | null {
  const source = object['reliefSource'];
  if (!isObject(source) || source['kind'] !== 'heightfield-v1') return null;
  const bounds = object['bounds'];
  if (!isObject(bounds)) return null;
  const binding = heightfieldBinding(source, bounds);
  if (binding === null) return null;
  if (!nearlyEqual(object['targetWidthMm'], binding.width)) {
    return `invalid \`${path}.targetWidthMm\`: must match reliefSource.physicalWidthMm`;
  }
  if (!nearlyEqual(object['reliefDepthMm'], binding.maxDepthMm)) {
    return `invalid \`${path}.reliefDepthMm\`: must match reliefSource.mapping.maxDepthMm`;
  }
  const matchesBounds = bindingMatchesBounds(binding);
  return matchesBounds
    ? null
    : `invalid \`${path}.bounds\`: must match reliefSource physical dimensions`;
}

type HeightfieldBinding = {
  readonly width: number;
  readonly height: number;
  readonly maxDepthMm: number;
  readonly bounds: Record<string, unknown>;
};

function heightfieldBinding(
  source: Record<string, unknown>,
  bounds: Record<string, unknown>,
): HeightfieldBinding | null {
  const width = source['physicalWidthMm'];
  const height = source['physicalHeightMm'];
  const mapping = source['mapping'];
  if (typeof width !== 'number' || typeof height !== 'number' || !isObject(mapping)) return null;
  const maxDepthMm = mapping['maxDepthMm'];
  return typeof maxDepthMm === 'number' ? { width, height, maxDepthMm, bounds } : null;
}

function bindingMatchesBounds(binding: HeightfieldBinding): boolean {
  return (
    binding.bounds['minX'] === 0 &&
    binding.bounds['minY'] === 0 &&
    nearlyEqual(binding.bounds['maxX'], binding.width) &&
    nearlyEqual(binding.bounds['maxY'], binding.height)
  );
}

function validateMetadata(value: Record<string, unknown>, path: string): string | null {
  return firstError([
    validOrMissing(value['schemaVersion'] === 1, `${path}.schemaVersion`),
    validOrMissing(positiveSafeInteger(value['width']), `${path}.width`),
    validOrMissing(positiveSafeInteger(value['height']), `${path}.height`),
    validOrMissing(positiveFinite(value['physicalWidthMm']), `${path}.physicalWidthMm`),
    validOrMissing(positiveFinite(value['physicalHeightMm']), `${path}.physicalHeightMm`),
    validOrMissing(value['encoding'] === 'u16le-base64-v1', `${path}.encoding`),
    validOrMissing(typeof value['samplesBase64'] === 'string', `${path}.samplesBase64`),
    validateMapping(value['mapping'], `${path}.mapping`),
    validateProvenance(value['provenance'], `${path}.provenance`),
    validOrMissing(
      value['algorithmRevision'] === 'heightfield-map-v1',
      `${path}.algorithmRevision`,
    ),
    validOrMissing(nonNegativeSafeInteger(value['revision']), `${path}.revision`),
    validOrMissing(validDigest(value['digest']), `${path}.digest`),
  ]);
}

type DecodedPayload = { readonly samples: Uint8Array; readonly mask?: Uint8Array };

function decodePayload(
  value: Record<string, unknown>,
  path: string,
  runtime: ReliefHeightfieldValidationRuntime,
): DecodedPayload | string {
  const width = value['width'] as number;
  const height = value['height'] as number;
  const sampleCount = width * height;
  const expectedSampleBytes = sampleCount * 2;
  if (!Number.isSafeInteger(sampleCount) || !Number.isSafeInteger(expectedSampleBytes)) {
    return `\`${path}\` sample count exceeds the exact numeric range`;
  }
  const samples = decodeExact(
    value['samplesBase64'] as string,
    expectedSampleBytes,
    `${path}.samplesBase64`,
    runtime,
  );
  if (typeof samples === 'string') return samples;
  const maskValue = value['inclusionMask'];
  if (maskValue === undefined) return { samples };
  if (!isObject(maskValue) || maskValue['encoding'] !== 'u8-base64-v1') {
    return `missing or invalid \`${path}.inclusionMask\``;
  }
  if (typeof maskValue['samplesBase64'] !== 'string') {
    return `missing or invalid \`${path}.inclusionMask.samplesBase64\``;
  }
  const mask = decodeExact(
    maskValue['samplesBase64'],
    sampleCount,
    `${path}.inclusionMask.samplesBase64`,
    runtime,
  );
  return typeof mask === 'string' ? mask : { samples, mask };
}

function decodeExact(
  value: string,
  length: number,
  path: string,
  runtime: ReliefHeightfieldValidationRuntime,
): Uint8Array | string {
  const actualLength = canonicalBase64ByteLength(value);
  if (actualLength === null) return `malformed canonical base64 in \`${path}\``;
  if (actualLength !== length) {
    return `\`${path}\` length does not match declared dimensions and encoding`;
  }
  let decoded: Base64DecodeResult;
  try {
    decoded = runtime.decodeBase64(value);
  } catch (error) {
    if (error instanceof RangeError) return allocationError(path);
    throw error;
  }
  if (decoded.kind === 'error') {
    return decoded.code === 'allocation'
      ? allocationError(path)
      : `malformed canonical base64 in \`${path}\``;
  }
  return decoded.bytes;
}

function allocationError(path: string): string {
  return `allocation failed for \`${path}\``;
}

function validateMapping(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    validatePolarity(value['polarity'], `${path}.polarity`),
    validOrMissing(u16Code(value['inputLowCode']), `${path}.inputLowCode`),
    validOrMissing(u16Code(value['inputHighCode']), `${path}.inputHighCode`),
    validateCurve(value['curve'], `${path}.curve`),
    validOrMissing(positiveFinite(value['maxDepthMm']), `${path}.maxDepthMm`),
    validateCrop(value['crop'], `${path}.crop`),
    validateAspect(value['aspect'], `${path}.aspect`),
    validateThreshold(value['inclusionThreshold'], `${path}.inclusionThreshold`),
    validateOutsideMask(value['outsideMask'], `${path}.outsideMask`),
  ]);
}

function validatePolarity(value: unknown, path: string): string | null {
  return validOrMissing(value === 'light-is-high' || value === 'light-is-deep', path);
}

function validateCurve(value: unknown, path: string): string | null {
  return validOrMissing(
    isObject(value) && value['kind'] === 'gamma-v1' && positiveFinite(value['gamma']),
    path,
  );
}

function validateAspect(value: unknown, path: string): string | null {
  return validOrMissing(value === 'preserve' || value === 'stretch', path);
}

function validateThreshold(threshold: unknown, path: string): string | null {
  if (
    typeof threshold !== 'number' ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > 255
  ) {
    return `missing or invalid \`${path}\``;
  }
  return null;
}

function validateOutsideMask(value: unknown, path: string): string | null {
  return validOrMissing(
    value === 'stock-top' || value === 'relief-floor' || value === 'excluded',
    path,
  );
}

function validateCrop(value: unknown, path: string): string | null {
  if (!isObject(value) || value['kind'] !== 'normalized-v1') {
    return `missing or invalid \`${path}\``;
  }
  const x = value['x'];
  const y = value['y'];
  const width = value['width'];
  const height = value['height'];
  if (!unitCoordinate(x) || !unitCoordinate(y) || !positiveUnit(width) || !positiveUnit(height)) {
    return `missing or invalid \`${path}\``;
  }
  return x + width <= 1 && y + height <= 1
    ? null
    : `invalid \`${path}\`: normalized crop exceeds the source field`;
}

function validateProvenance(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  if (!(SOURCE_KINDS as ReadonlyArray<unknown>).includes(value['sourceKind'])) {
    return `missing or invalid \`${path}.sourceKind\``;
  }
  if (typeof value['sourceName'] !== 'string') return `missing or invalid \`${path}.sourceName\``;
  if (
    value['sourceBitDepth'] !== undefined &&
    value['sourceBitDepth'] !== 8 &&
    value['sourceBitDepth'] !== 16
  ) {
    return `missing or invalid \`${path}.sourceBitDepth\``;
  }
  if (
    value['sourcePolarity'] !== undefined &&
    value['sourcePolarity'] !== 'light-is-high' &&
    value['sourcePolarity'] !== 'light-is-deep'
  ) {
    return `missing or invalid \`${path}.sourcePolarity\``;
  }
  return validateProducer(value['producer'], `${path}.producer`);
}

function validateProducer(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!isObject(value) || typeof value['name'] !== 'string')
    return `missing or invalid \`${path}\``;
  if (value['model'] !== undefined && typeof value['model'] !== 'string') {
    return `missing or invalid \`${path}.model\``;
  }
  return value['version'] === undefined || typeof value['version'] === 'string'
    ? null
    : `missing or invalid \`${path}.version\``;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function u16Code(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

function unitCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1;
}

function positiveUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;
}

function nearlyEqual(value: unknown, expected: number): boolean {
  return (
    typeof value === 'number' &&
    Math.abs(value - expected) <= 1e-9 * Math.max(1, Math.abs(expected))
  );
}

function validDigest(value: unknown): boolean {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function validOrMissing(valid: boolean, path: string): string | null {
  return valid ? null : `missing or invalid \`${path}\``;
}

function firstError(errors: ReadonlyArray<string | null>): string | null {
  return errors.find((error): error is string => error !== null) ?? null;
}
