import { canonicalBase64ByteLength } from '../../core/relief/depth-map-base64';
import { isObject } from './project-shape-primitives';

export function validateReliefDepthMapSource(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const metadataError = validateDepthMapMetadata(value, path);
  if (metadataError !== null) return metadataError;
  return validateDepthMapPayload(value, path);
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
