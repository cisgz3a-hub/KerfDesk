import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalBase64ByteLength,
  decodeCanonicalBase64,
  encodeCanonicalBase64,
} from './depth-map-base64';

describe('canonical relief base64', () => {
  it('round-trips arbitrary bytes with canonical padding', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (bytes) => {
        const encoded = encodeCanonicalBase64(bytes);
        if (bytes.length === 0) {
          expect(encoded).toBe('');
          return;
        }
        expect(canonicalBase64ByteLength(encoded)).toBe(bytes.length);
        expect(decodeCanonicalBase64(encoded)).toEqual({ kind: 'ok', bytes });
      }),
      { numRuns: 100 },
    );
  });

  it.each([
    [Uint8Array.of(0), 'AA=='],
    [Uint8Array.of(0, 1), 'AAE='],
    [Uint8Array.of(0, 1, 2), 'AAEC'],
  ])('encodes exact RFC 4648-compatible vectors', (bytes, expected) => {
    expect(encodeCanonicalBase64(bytes)).toBe(expected);
  });

  it('rejects aliases with non-zero unused bits', () => {
    expect(canonicalBase64ByteLength('AB==')).toBeNull();
    expect(canonicalBase64ByteLength('AAB=')).toBeNull();
  });

  it('reports allocation failure separately without throwing', () => {
    const failAllocation = (): Uint8Array => {
      throw new RangeError('controlled allocation failure');
    };

    expect(() => decodeCanonicalBase64('AA==', failAllocation)).not.toThrow();
    expect(decodeCanonicalBase64('AA==', failAllocation)).toEqual({
      kind: 'error',
      code: 'allocation',
      reason: 'Base64 payload does not fit in this runtime.',
    });
  });

  it('rejects an allocator result with the wrong byte length', () => {
    expect(decodeCanonicalBase64('AA==', () => new Uint8Array(0))).toEqual({
      kind: 'error',
      code: 'allocation',
      reason: 'Base64 payload does not fit in this runtime.',
    });
  });

  it('does not relabel a programmer exception as an allocation failure', () => {
    const programmerError = new Error('controlled programmer error');
    expect(() =>
      decodeCanonicalBase64('AA==', () => {
        throw programmerError;
      }),
    ).toThrow(programmerError);
  });
});
