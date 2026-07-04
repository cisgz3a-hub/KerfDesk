const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function validateRasterLumaBase64(
  value: string,
  expectedLength: number,
  path: string,
): string | null {
  const byteLength = decodedBase64ByteLength(value);
  if (byteLength === null || byteLength !== expectedLength) {
    return `invalid \`${path}.lumaBase64\``;
  }
  return null;
}

function decodedBase64ByteLength(value: string): number | null {
  const clean = cleanedBase64(value);
  if (clean === null) return null;
  const dataLength = base64DataLength(clean);
  if (dataLength === null) return null;
  let bytes = 0;
  let buffer = 0;
  let bitCount = 0;
  for (let index = 0; index < dataLength; index += 1) {
    const charValue = BASE64_ALPHABET.indexOf(clean[index] ?? '');
    buffer = (buffer << 6) | charValue;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes += 1;
      buffer &= (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0 && buffer !== 0) return null;
  return bytes;
}

function cleanedBase64(value: string): string | null {
  let clean = '';
  for (const char of value) {
    if (isBase64Whitespace(char)) continue;
    if (char !== '=' && BASE64_ALPHABET.indexOf(char) === -1) return null;
    clean += char;
  }
  return clean;
}

function base64DataLength(clean: string): number | null {
  const paddingStart = clean.indexOf('=');
  if (clean.length % 4 === 1) return null;
  if (paddingStart === -1) return clean.length;
  const paddingCount = clean.length - paddingStart;
  if (paddingCount > 2 || clean.length % 4 !== 0) return null;
  return clean.slice(paddingStart).replaceAll('=', '') === '' ? paddingStart : null;
}

function isBase64Whitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}
