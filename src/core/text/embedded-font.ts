import type { EmbeddedFont } from '../scene';
import { decodeBase64Into, encodeBase64 } from '../util/base64-codec';

export const MAX_EMBEDDED_FONT_BYTES = 10 * 1024 * 1024;

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

// The codec gives the text and bytes the old one-character loops gave, 8 to 100 times faster
// (performance audit S7-P2-2): a 9.3 MB system font blocked the window for about a second.
function decodeBase64(value: string): Uint8Array {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  decodeBase64Into(value, output);
  return output;
}
