const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode bytes as canonical padded base64 without browser or Node globals. */
export function encodeCanonicalBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkCharacters: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 3) {
    chunkCharacters.push(encodeTriplet(bytes, offset));
    if (chunkCharacters.length >= 64 * 1024) {
      chunks.push(chunkCharacters.join(''));
      chunkCharacters.length = 0;
    }
  }
  if (chunkCharacters.length > 0) chunks.push(chunkCharacters.join(''));
  return chunks.join('');
}

function encodeTriplet(bytes: Uint8Array, offset: number): string {
  const remaining = bytes.length - offset;
  const packed =
    (byteAt(bytes, offset) << 16) | (byteAt(bytes, offset + 1) << 8) | byteAt(bytes, offset + 2);
  return (
    alphabetAt((packed >>> 18) & 0x3f) +
    alphabetAt((packed >>> 12) & 0x3f) +
    (remaining > 1 ? alphabetAt((packed >>> 6) & 0x3f) : '=') +
    (remaining > 2 ? alphabetAt(packed & 0x3f) : '=')
  );
}

function alphabetAt(index: number): string {
  return BASE64_ALPHABET[index] ?? '';
}

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

/** Result of decoding a canonical padded base64 payload without browser globals. */
export type Base64DecodeResult =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | {
      readonly kind: 'error';
      readonly code: 'malformed' | 'allocation';
      readonly reason: string;
    };

export type Base64ByteAllocator = (byteLength: number) => Uint8Array;

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
export function decodeCanonicalBase64(
  value: string,
  allocate: Base64ByteAllocator = allocateUint8Array,
): Base64DecodeResult {
  const byteLength = canonicalBase64ByteLength(value);
  if (byteLength === null)
    return {
      kind: 'error',
      code: 'malformed',
      reason: 'Sample payload is not canonical base64.',
    };
  return decodeCanonicalBytes(value, byteLength, allocate);
}

function decodeCanonicalBytes(
  value: string,
  byteLength: number,
  allocate: Base64ByteAllocator,
): Base64DecodeResult {
  const bytes = allocateBytes(byteLength, allocate);
  if (bytes === null) {
    return {
      kind: 'error',
      code: 'allocation',
      reason: 'Base64 payload does not fit in this runtime.',
    };
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

function allocateBytes(byteLength: number, allocate: Base64ByteAllocator): Uint8Array | null {
  try {
    const bytes = allocate(byteLength);
    return bytes.byteLength === byteLength ? bytes : null;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

function allocateUint8Array(byteLength: number): Uint8Array {
  return new Uint8Array(byteLength);
}
