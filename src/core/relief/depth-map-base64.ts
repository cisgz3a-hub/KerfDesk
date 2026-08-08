const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Result of decoding a canonical padded base64 payload without browser globals. */
export type Base64DecodeResult =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | { readonly kind: 'error'; readonly reason: string };

/** Canonical padded base64 byte length, or null when the text is malformed. */
export function canonicalBase64ByteLength(value: string): number | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  const padding = base64Padding(value);
  const dataLength = value.length - padding;
  if (!hasOnlyBase64Data(value, dataLength)) return null;
  if (!hasOnlyExpectedPadding(value, dataLength)) return null;
  if (!hasCanonicalUnusedBits(value, dataLength, padding)) return null;
  return (value.length / 4) * 3 - padding;
}

function base64Padding(value: string): 0 | 1 | 2 {
  if (value.endsWith('==')) return 2;
  return value.endsWith('=') ? 1 : 0;
}

function hasOnlyBase64Data(value: string, dataLength: number): boolean {
  for (let index = 0; index < dataLength; index += 1) {
    if (BASE64_ALPHABET.indexOf(value[index] ?? '') < 0) return false;
  }
  return true;
}

function hasOnlyExpectedPadding(value: string, dataLength: number): boolean {
  for (let index = dataLength; index < value.length; index += 1) {
    if (value[index] !== '=') return false;
  }
  return true;
}

function hasCanonicalUnusedBits(value: string, dataLength: number, padding: number): boolean {
  if (padding === 2) {
    const final = BASE64_ALPHABET.indexOf(value[dataLength - 1] ?? '');
    return final >= 0 && (final & 0x0f) === 0;
  }
  if (padding === 1) {
    const final = BASE64_ALPHABET.indexOf(value[dataLength - 1] ?? '');
    return final >= 0 && (final & 0x03) === 0;
  }
  return true;
}

/** Decode canonical padded base64, returning malformed input or allocation failure as data. */
export function decodeCanonicalBase64(value: string): Base64DecodeResult {
  const byteLength = canonicalBase64ByteLength(value);
  if (byteLength === null)
    return { kind: 'error', reason: 'Sample payload is not canonical base64.' };
  return decodeCanonicalBytes(value, byteLength);
}

function decodeCanonicalBytes(value: string, byteLength: number): Base64DecodeResult {
  const bytes = allocateBytes(byteLength);
  if (bytes === null) {
    return { kind: 'error', reason: 'Depth-map samples do not fit in this runtime.' };
  }
  let output = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64_ALPHABET.indexOf(value[index] ?? '');
    const b = BASE64_ALPHABET.indexOf(value[index + 1] ?? '');
    const c = value[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 2] ?? '');
    const d = value[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 3] ?? '');
    const packed = (a << 18) | (b << 12) | (c << 6) | d;
    if (output < byteLength) bytes[output++] = (packed >>> 16) & 0xff;
    if (output < byteLength) bytes[output++] = (packed >>> 8) & 0xff;
    if (output < byteLength) bytes[output++] = packed & 0xff;
  }
  return { kind: 'ok', bytes };
}

function allocateBytes(byteLength: number): Uint8Array | null {
  try {
    return new Uint8Array(byteLength);
  } catch {
    return null;
  }
}
