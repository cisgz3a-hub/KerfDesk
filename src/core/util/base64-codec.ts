// Base64 for core, which may not use the browser's atob or btoa (performance
// audit S7-P2-2).
//
// The embedded-font codec built its text one character at a time and looked
// each character up with indexOf, so a 9.3 MB system font blocked the window
// for 0.7-1.0 s to embed and about 0.5 s more each time a session first used
// it. These use the language's own Uint8Array base64 methods where the engine
// has them (Chromium 140 and Electron 44 do), and otherwise write character
// codes into a buffer and read them through a table. Both give the text and
// bytes the old loops gave, for every input: text the native decoder refuses or
// reads short goes through the table, which reads a stray character the way
// `alphabet.indexOf` did.

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PAD = 61; // '='
// A multiple of 3 bytes, so only the last chunk can carry padding: 32,768 characters.
const ENCODE_CHUNK_BYTES = 24_576;
const ALPHABET_CODES = Uint8Array.from(BASE64_ALPHABET, (char) => char.charCodeAt(0));
const DIGITS = digitTable();

type NativeBase64Bytes = Uint8Array & {
  readonly toBase64?: () => string;
  readonly setFromBase64?: (text: string) => { readonly read: number; readonly written: number };
};

/** Canonical padded base64 of `bytes`. */
export function encodeBase64(bytes: Uint8Array): string {
  const native = (bytes as NativeBase64Bytes).toBase64;
  if (typeof native === 'function') return native.call(bytes);
  const chunks: string[] = [];
  const codes = new Uint8Array((ENCODE_CHUNK_BYTES / 3) * 4);
  for (let start = 0; start < bytes.length; start += ENCODE_CHUNK_BYTES) {
    const end = Math.min(start + ENCODE_CHUNK_BYTES, bytes.length);
    const length = encodeChunk(bytes, start, end, codes);
    // apply accepts a typed array as its argument list, without an Array copy.
    chunks.push(String.fromCharCode.apply(null, codes.subarray(0, length) as unknown as number[]));
  }
  return chunks.join('');
}

/**
 * Decodes `value` four characters at a time into `output`, stopping when it is
 * full. '=' reads as 0 wherever it stands, and any other character outside the
 * alphabet as -1, as the old decoders' `alphabet.indexOf` did.
 */
export function decodeBase64Into(value: string, output: Uint8Array): void {
  if (decodedNatively(value, output)) return;
  let at = 0;
  const total = output.length;
  for (let index = 0; index < value.length && at < total; index += 4) {
    const bits =
      (digit(value, index) << 18) |
      (digit(value, index + 1) << 12) |
      (digit(value, index + 2) << 6) |
      digit(value, index + 3);
    output[at++] = (bits >> 16) & 255;
    if (at < total) output[at++] = (bits >> 8) & 255;
    if (at < total) output[at++] = bits & 255;
  }
}

// The native decoder only where it reads what the table would. It refuses a
// stray character or a misplaced '=' (the table reads them), and it skips
// whitespace, which leaves it short of the output's length; either way the
// table decodes the text again, over every byte.
function decodedNatively(value: string, output: Uint8Array): boolean {
  const native = (output as NativeBase64Bytes).setFromBase64;
  if (typeof native !== 'function' || value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if ((value.length / 4) * 3 - padding !== output.length) return false;
  try {
    const result = native.call(output, value);
    return result.read === value.length && result.written === output.length;
  } catch {
    return false;
  }
}

function encodeChunk(bytes: Uint8Array, start: number, end: number, codes: Uint8Array): number {
  let at = 0;
  let index = start;
  for (; index + 2 < end; index += 3) {
    const bits =
      ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    at = writeQuad(codes, at, bits, 4);
  }
  const left = end - index;
  if (left === 0) return at;
  const second = left === 2 ? (bytes[index + 1] ?? 0) : 0;
  return writeQuad(codes, at, ((bytes[index] ?? 0) << 16) | (second << 8), left + 1);
}

// Writes the first `digits` characters of a group and pads it to four.
function writeQuad(codes: Uint8Array, at: number, bits: number, digits: number): number {
  codes[at] = ALPHABET_CODES[(bits >> 18) & 63] ?? PAD;
  codes[at + 1] = ALPHABET_CODES[(bits >> 12) & 63] ?? PAD;
  codes[at + 2] = digits > 2 ? (ALPHABET_CODES[(bits >> 6) & 63] ?? PAD) : PAD;
  codes[at + 3] = digits > 3 ? (ALPHABET_CODES[bits & 63] ?? PAD) : PAD;
  return at + 4;
}

function digit(value: string, index: number): number {
  if (index >= value.length) return 0; // read as '='
  const code = value.charCodeAt(index);
  return code < 256 ? (DIGITS[code] ?? -1) : -1;
}

function digitTable(): Int8Array {
  const table = new Int8Array(256).fill(-1);
  for (let value = 0; value < 64; value += 1) table[ALPHABET_CODES[value] ?? 0] = value;
  table[PAD] = 0;
  return table;
}
