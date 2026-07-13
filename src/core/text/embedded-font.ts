import type { EmbeddedFont } from '../scene';

export const MAX_EMBEDDED_FONT_BYTES = 10 * 1024 * 1024;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function embeddedFontBuffer(font: EmbeddedFont): ArrayBuffer {
  const bytes = decodeBase64(font.dataBase64);
  assertSupportedFont(bytes);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function encodeEmbeddedFont(args: {
  readonly key: string;
  readonly fileName: string;
  readonly buffer: ArrayBuffer;
}): EmbeddedFont {
  if (args.buffer.byteLength > MAX_EMBEDDED_FONT_BYTES) {
    throw new Error(`Font exceeds the ${MAX_EMBEDDED_FONT_BYTES}-byte project limit.`);
  }
  const bytes = new Uint8Array(args.buffer);
  assertSupportedFont(bytes);
  return { key: args.key, fileName: args.fileName, dataBase64: encodeBase64(bytes) };
}

function assertSupportedFont(bytes: Uint8Array): void {
  if (bytes.byteLength < 4) throw new Error('Font file is empty or truncated.');
  const signature = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
  const supported = [0x00010000, 0x4f54544f, 0x74727565, 0x74797031].includes(signature);
  if (!supported) {
    throw new Error('File is not a supported TrueType or OpenType font.');
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const bits = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += BASE64_ALPHABET[(bits >> 18) & 63] ?? '';
    encoded += BASE64_ALPHABET[(bits >> 12) & 63] ?? '';
    encoded += second === undefined ? '=' : (BASE64_ALPHABET[(bits >> 6) & 63] ?? '');
    encoded += third === undefined ? '=' : (BASE64_ALPHABET[bits & 63] ?? '');
  }
  return encoded;
}

function decodeBase64(value: string): Uint8Array {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const bits = decodeBase64Block(value, index);
    if (outputIndex < output.length) output[outputIndex++] = (bits >> 16) & 255;
    if (outputIndex < output.length) output[outputIndex++] = (bits >> 8) & 255;
    if (outputIndex < output.length) output[outputIndex++] = bits & 255;
  }
  return output;
}

function decodeBase64Block(value: string, index: number): number {
  const digit = (offset: number): number => {
    const char = value[index + offset] ?? '=';
    return char === '=' ? 0 : BASE64_ALPHABET.indexOf(char);
  };
  return (digit(0) << 18) | (digit(1) << 12) | (digit(2) << 6) | digit(3);
}
