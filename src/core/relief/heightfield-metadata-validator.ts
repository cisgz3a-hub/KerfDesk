import type { ReliefHeightfield } from '../scene/relief';

type HeightfieldTargetBinding = {
  readonly targetWidthMm: number;
  readonly reliefDepthMm: number;
};

/** Validate the non-payload contract required before heightfield materialization. */
export function heightfieldMetadataError(
  source: ReliefHeightfield,
  options: HeightfieldTargetBinding,
): string | null {
  return firstError([
    heightfieldSchemaError(source),
    heightfieldDimensionsError(source),
    heightfieldPhysicalSizeError(source),
    heightfieldTargetBindingError(source, options),
    heightfieldEncodingError(source),
    heightfieldRevisionError(source),
    mappingError(source),
  ]);
}

function heightfieldSchemaError(source: ReliefHeightfield): string | null {
  if (source.kind !== 'heightfield-v1' || source.schemaVersion !== 1) {
    return 'Relief heightfield schema version is unsupported.';
  }
  return null;
}

function heightfieldDimensionsError(source: ReliefHeightfield): string | null {
  if (!positiveSafeInteger(source.width) || !positiveSafeInteger(source.height)) {
    return 'Relief heightfield dimensions must be positive safe integers.';
  }
  return null;
}

function heightfieldPhysicalSizeError(source: ReliefHeightfield): string | null {
  if (!positiveFinite(source.physicalWidthMm) || !positiveFinite(source.physicalHeightMm)) {
    return 'Relief heightfield physical dimensions must be finite and positive.';
  }
  return null;
}

function heightfieldTargetBindingError(
  source: ReliefHeightfield,
  options: HeightfieldTargetBinding,
): string | null {
  if (
    !positiveFinite(options.targetWidthMm) ||
    !nearlyEqual(options.targetWidthMm, source.physicalWidthMm)
  ) {
    return 'Relief target width must match the canonical field width.';
  }
  const mapping = record(source.mapping);
  const maxDepthMm = mapping?.['maxDepthMm'];
  if (!positiveFinite(options.reliefDepthMm)) {
    return 'Relief depth must match the canonical field mapping.';
  }
  if (positiveFinite(maxDepthMm) && !nearlyEqual(options.reliefDepthMm, maxDepthMm)) {
    return 'Relief depth must match the canonical field mapping.';
  }
  return null;
}

function heightfieldEncodingError(source: ReliefHeightfield): string | null {
  if (source.encoding !== 'u16le-base64-v1') return 'Relief heightfield encoding is unsupported.';
  if (typeof source.samplesBase64 !== 'string') {
    return 'Relief heightfield payload must be base64 text.';
  }
  if (typeof source.digest !== 'string') return 'Relief heightfield digest is invalid.';
  return null;
}

function heightfieldRevisionError(source: ReliefHeightfield): string | null {
  if (source.algorithmRevision !== 'heightfield-map-v1') {
    return 'Relief heightfield mapping revision is unsupported.';
  }
  if (!nonnegativeSafeInteger(source.revision)) {
    return 'Relief heightfield revision is invalid.';
  }
  return null;
}

function mappingError(source: ReliefHeightfield): string | null {
  const mapping = record(source.mapping);
  if (mapping === null) return 'Relief heightfield mapping is invalid.';
  return firstError([
    mappingPolarityError(mapping),
    mappingLevelsError(mapping),
    mappingCurveError(mapping),
    positiveFinite(mapping['maxDepthMm']) ? null : 'Relief heightfield maximum depth is invalid.',
    normalizedCropError(mapping['crop']),
    mappingAspectError(mapping),
    mappingInclusionError(mapping),
  ]);
}

function mappingPolarityError(mapping: Record<string, unknown>): string | null {
  if (mapping['polarity'] !== 'light-is-high' && mapping['polarity'] !== 'light-is-deep') {
    return 'Relief heightfield polarity is invalid.';
  }
  return null;
}

function mappingLevelsError(mapping: Record<string, unknown>): string | null {
  if (!u16Code(mapping['inputLowCode']) || !u16Code(mapping['inputHighCode'])) {
    return 'Relief heightfield input levels are invalid.';
  }
  return null;
}

function mappingCurveError(mapping: Record<string, unknown>): string | null {
  const curve = record(mapping['curve']);
  if (curve === null || curve['kind'] !== 'gamma-v1' || !positiveFinite(curve['gamma'])) {
    return 'Relief heightfield curve is invalid.';
  }
  return null;
}

function mappingAspectError(mapping: Record<string, unknown>): string | null {
  if (mapping['aspect'] !== 'preserve' && mapping['aspect'] !== 'stretch') {
    return 'Relief heightfield aspect policy is invalid.';
  }
  return null;
}

function mappingInclusionError(mapping: Record<string, unknown>): string | null {
  const threshold = mapping['inclusionThreshold'];
  if (
    typeof threshold !== 'number' ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > 255
  ) {
    return 'Relief heightfield inclusion threshold is invalid.';
  }
  const outsideMask = mapping['outsideMask'];
  if (outsideMask !== 'stock-top' && outsideMask !== 'relief-floor' && outsideMask !== 'excluded') {
    return 'Relief heightfield outside-mask meaning is invalid.';
  }
  return null;
}

function normalizedCropError(value: unknown): string | null {
  const crop = record(value);
  if (crop === null || crop['kind'] !== 'normalized-v1') {
    return 'Relief heightfield crop is invalid.';
  }
  const x = crop['x'];
  const y = crop['y'];
  const width = crop['width'];
  const height = crop['height'];
  if (
    !nonnegativeFinite(x) ||
    !nonnegativeFinite(y) ||
    !positiveFinite(width) ||
    !positiveFinite(height) ||
    x + width > 1 ||
    y + height > 1
  ) {
    return 'Relief heightfield crop is invalid.';
  }
  return null;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nonnegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function u16Code(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

function nearlyEqual(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function firstError(errors: ReadonlyArray<string | null>): string | null {
  return errors.find((error): error is string => error !== null) ?? null;
}
