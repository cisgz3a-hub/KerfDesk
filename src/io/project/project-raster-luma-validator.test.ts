import { describe, expect, it } from 'vitest';
import { validateRasterLumaBase64 } from './project-raster-luma-validator';

function accepted(value: string, bytes: number): boolean {
  return validateRasterLumaBase64(value, bytes, 'raster') === null;
}

describe('raster luma validation without a decoded or cleaned copy', () => {
  it('accepts canonical padded/unpadded bytes and the existing four whitespace characters', () => {
    for (let length = 0; length < 130; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 137 + length) % 256);
      const text = Buffer.from(bytes).toString('base64');
      expect(accepted(text, length)).toBe(true);
      expect(accepted(text.replace(/=+$/, ''), length)).toBe(true);
      expect(accepted(`\r\n${[...text].join(' \t')}\n`, length)).toBe(true);
      expect(accepted(text, length + 1)).toBe(false);
    }
  });

  it('rejects malformed alphabet, padding and nonzero trailing bits', () => {
    for (const text of [
      'A',
      'A=',
      'A==',
      'A===',
      '=',
      '==',
      '====',
      'AAAA=',
      'AA=A',
      'AA==A',
      'AB',
      'AB==',
      'AAB',
      'AAB=',
      'AA_',
      'AA-',
      'AA\v',
      'AA\f',
      'AA\u00a0',
      'AA😀',
    ]) {
      for (const length of [0, 1, 2, 3, 4]) expect(accepted(text, length), text).toBe(false);
    }
    expect(validateRasterLumaBase64('AB==', 1, 'scene.objects[0]')).toBe(
      'invalid `scene.objects[0].lumaBase64`',
    );
  });

  it('matches the former decoder for exhaustive short inputs and deterministic malformed strings', () => {
    const alphabet = ['A', 'B', 'E', 'Q', '/', '=', ' ', '\t', '\n', '\r', '_', '\u00a0'];
    const compare = (text: string): void => {
      const oldLength = legacyLength(text);
      for (let length = 0; length <= Math.floor((text.length * 3) / 4) + 1; length++) {
        expect(accepted(text, length), JSON.stringify(text)).toBe(oldLength === length);
      }
    };
    const enumerate = (prefix: string, depth: number): void => {
      compare(prefix);
      if (depth > 0) for (const char of alphabet) enumerate(prefix + char, depth - 1);
    };
    enumerate('', 4);
    let seed = 0x25c0ffee;
    for (let test = 0; test < 10_000; test++) {
      let text = '';
      for (let i = 0; i < test % 57; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        text += alphabet[seed % alphabet.length];
      }
      compare(text);
    }
  });

  it('validates a large raster without changing the source string', () => {
    const bytes = Buffer.alloc(1024 * 1024, 147);
    const text = bytes.toString('base64');
    expect(accepted(text, bytes.length)).toBe(true);
    expect(accepted(`${text.slice(0, -3)}B==`, bytes.length)).toBe(false);
    expect(Buffer.from(text, 'base64').equals(bytes)).toBe(true);
  });
});

// Frozen pre-change grammar provides an independent compatibility reference.
function legacyLength(value: string): number | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = legacyClean(value, alphabet);
  if (clean === null) return null;
  const length = legacyDataLength(clean);
  if (length === null) return null;
  let bytes = 0,
    buffer = 0,
    bits = 0;
  for (let i = 0; i < length; i++) {
    buffer = (buffer << 6) | alphabet.indexOf(clean[i] ?? '');
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes++;
      buffer &= (1 << bits) - 1;
    }
  }
  return bits > 0 && buffer !== 0 ? null : bytes;
}

function legacyClean(value: string, alphabet: string): string | null {
  let clean = '';
  for (const char of value) {
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') continue;
    if (char !== '=' && alphabet.indexOf(char) === -1) return null;
    clean += char;
  }
  return clean;
}

function legacyDataLength(clean: string): number | null {
  const start = clean.indexOf('=');
  if (clean.length % 4 === 1) return null;
  if (start === -1) return clean.length;
  if (clean.length - start > 2 || clean.length % 4 !== 0) return null;
  return clean.slice(start).replaceAll('=', '') === '' ? start : null;
}
