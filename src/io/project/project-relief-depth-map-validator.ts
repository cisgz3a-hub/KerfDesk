import { canonicalBase64ByteLength } from '../../core/relief/depth-map-base64';
import { isObject } from './project-shape-primitives';

/** Validate the durable metadata and canonical sample payload for one depth-map source. */
export function validateReliefDepthMapSource(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const metadataError = validateDepthMapMetadata(value, path);
  if (metadataError !== null) return metadataError;
  return validateDepthMapPayload(value, path);
}

/** Keep durable local bounds aligned with the source aspect used by CAM and preview. */
export function validateReliefDepthMapBounds(
  obj: Record<string, unknown>,
  path: string,
): string | null {
  const depthMap = obj['depthMap'];
  if (!isObject(depthMap)) return null;
  const bounds = obj['bounds'];
  const targetWidthMm = obj['targetWidthMm'];
  const width = depthMap['width'];
  const height = depthMap['height'];
  if (
    !isObject(bounds) ||
    typeof targetWidthMm !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return null;
  }
  const expectedHeightMm = targetWidthMm * (height / width);
  const matchesNaturalBounds =
    bounds['minX'] === 0 &&
    bounds['minY'] === 0 &&
    nearlyEqual(bounds['maxX'], targetWidthMm) &&
    nearlyEqual(bounds['maxY'], expectedHeightMm);
  return matchesNaturalBounds
    ? null
    : `invalid \`${path}.bounds\`: depth-map relief bounds must match source aspect and target width`;
}

function validateDepthMapMetadata(value: Record<string, unknown>, path: string): string | null {
  if (value['schemaVersion'] !== 1) return `missing or invalid \`${path}.schemaVersion\``;
  const width = value['width'];
  const height = value['height'];
  if (!positiveSafeInteger(width)) return `missing or invalid \`${path}.width\``;
  if (!positiveSafeInteger(height)) return `missing or invalid \`${path}.height\``;
  const bitDepth = value['bitDepth'];
  if (bitDepth !== 8 && bitDepth !== 16) return `missing or invalid \`${path}.bitDepth\``;
  const polarity = value['polarity'];
  if (polarity !== 'light-is-high' && polarity !== 'light-is-deep') {
    return `missing or invalid \`${path}.polarity\``;
  }
  return null;
}

function validateDepthMapPayload(value: Record<string, unknown>, path: string): string | null {
  const samplesBase64 = value['samplesBase64'];
  if (typeof samplesBase64 !== 'string') return `missing or invalid \`${path}.samplesBase64\``;
  // validateDepthMapMetadata runs first and establishes these numeric variants at runtime.
  const width = value['width'] as number;
  const height = value['height'] as number;
  const bitDepth = value['bitDepth'] as 8 | 16;
  const expectedBytes = width * height * (bitDepth / 8);
  if (!Number.isSafeInteger(expectedBytes)) {
    return `\`${path}\` sample count exceeds the exact numeric range`;
  }
  const actualBytes = canonicalBase64ByteLength(samplesBase64);
  if (actualBytes === null) return `malformed canonical base64 in \`${path}.samplesBase64\``;
  if (actualBytes !== expectedBytes) {
    return `\`${path}.samplesBase64\` length does not match width, height, and bit depth`;
  }
  return null;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nearlyEqual(value: unknown, expected: number): boolean {
  return (
    typeof value === 'number' &&
    Math.abs(value - expected) <= 1e-9 * Math.max(1, Math.abs(expected))
  );
}
