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
  // Validate/count in place: allocating a cleaned copy of a multi-megabyte
  // raster creates substantial garbage during autosave and project loading.
  let dataLength = 0;
  let padding = 0;
  let lastValue = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (isBase64Whitespace(code)) continue;
    if (code === 61) {
      if (++padding > 2) return null;
      continue;
    }
    const digit = base64Digit(code);
    if (digit === -1 || padding !== 0) return null;
    dataLength++;
    lastValue = digit;
  }
  return validBase64Tail(dataLength, padding, lastValue) ? Math.floor((dataLength * 3) / 4) : null;
}

function validBase64Tail(dataLength: number, padding: number, lastValue: number): boolean {
  const remainder = dataLength % 4;
  if (remainder === 1 || (padding !== 0 && (dataLength + padding) % 4 !== 0)) return false;
  // Retain canonical unused-bit validation for padded AND unpadded input.
  if ((remainder === 2 && (lastValue & 15) !== 0) || (remainder === 3 && (lastValue & 3) !== 0))
    return false;
  return true;
}

function isBase64Whitespace(code: number): boolean {
  return code === 32 || code === 10 || code === 13 || code === 9;
}

function base64Digit(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  return code === 47 ? 63 : -1;
}
