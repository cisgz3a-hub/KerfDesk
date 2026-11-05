import { afterEach, describe, expect, it } from 'vitest';
import { decodeBase64Into, encodeBase64 } from './base64-codec';

// The one-character-at-a-time codec embedded fonts used before performance audit
// S7-P2-2, kept as the reference the new one must match on every input.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function referenceEncode(bytes: Uint8Array): string {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const bits = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += ALPHABET[(bits >> 18) & 63] ?? '';
    encoded += ALPHABET[(bits >> 12) & 63] ?? '';
    encoded += second === undefined ? '=' : (ALPHABET[(bits >> 6) & 63] ?? '');
    encoded += third === undefined ? '=' : (ALPHABET[bits & 63] ?? '');
  }
  return encoded;
}

function referenceDecode(value: string, length: number): Uint8Array {
  const output = new Uint8Array(length);
  let at = 0;
  const digit = (index: number): number => {
    const char = value[index] ?? '=';
    return char === '=' ? 0 : ALPHABET.indexOf(char);
  };
  for (let index = 0; index < value.length; index += 4) {
    const bits =
      (digit(index) << 18) | (digit(index + 1) << 12) | (digit(index + 2) << 6) | digit(index + 3);
    if (at < output.length) output[at++] = (bits >> 16) & 255;
    if (at < output.length) output[at++] = (bits >> 8) & 255;
    if (at < output.length) output[at++] = bits & 255;
  }
  return output;
}

function decodedLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((value.length / 4) * 3 - padding));
}

function bytesOf(length: number, seed: number): Uint8Array {
  let state = seed;
  return Uint8Array.from({ length }, () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state >> 16;
  });
}

type NativeMethods = { toBase64?: unknown; setFromBase64?: unknown };
const proto = Uint8Array.prototype as NativeMethods;
const native = { toBase64: proto.toBase64, setFromBase64: proto.setFromBase64 };
afterEach(() => {
  if (native.toBase64 !== undefined) proto.toBase64 = native.toBase64;
  if (native.setFromBase64 !== undefined) proto.setFromBase64 = native.setFromBase64;
});

// Where the engine has Uint8Array's own base64 methods (Chromium 140+, Node 25) the
// codec uses them; elsewhere (Node 22 on CI) it falls back to its tables. Run both.
describe.each([
  ['the engine methods where present', false],
  ['the fallback tables', true],
])('base64 codec with %s', (_name, withoutNative) => {
  const prepare = (): void => {
    if (!withoutNative) return;
    delete proto.toBase64;
    delete proto.setFromBase64;
  };

  it('encodes every length as the old loop did', { timeout: 60_000 }, () => {
    prepare();
    for (let length = 0; length < 200; length += 1) {
      const bytes = bytesOf(length, length + 1);
      expect(encodeBase64(bytes)).toBe(referenceEncode(bytes));
    }
    const large = bytesOf(1_000_003, 7); // past several 24 KiB chunks, ends mid-group
    expect(encodeBase64(large)).toBe(referenceEncode(large));
  });

  it('decodes canonical text to the original bytes', { timeout: 60_000 }, () => {
    prepare();
    for (const length of [0, 1, 2, 3, 4, 5, 99, 24_576, 24_577, 100_001]) {
      const bytes = bytesOf(length, length + 3);
      const output = new Uint8Array(length);
      decodeBase64Into(referenceEncode(bytes), output);
      expect(output).toEqual(bytes);
    }
  });

  it('reads malformed text as the old decoder did', () => {
    prepare();
    const cases = [
      'Q!JD',
      'QU=D',
      '====',
      'QUJDRA',
      'QU JD',
      'é€AB',
      'QUJ',
      'QR==',
      'QUI=',
      'A===',
      '\nQUJD',
    ];
    for (const value of cases) {
      const output = new Uint8Array(decodedLength(value));
      decodeBase64Into(value, output);
      expect([value, Array.from(output)]).toEqual([
        value,
        Array.from(referenceDecode(value, output.length)),
      ]);
    }
  });
});
