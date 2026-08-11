import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('matches the NIST SHA-256 example for %j', (message, expected) => {
    expect(sha256Hex([text(message)])).toBe(expected);
  });

  it('is independent of input chunk boundaries', () => {
    expect(sha256Hex([text('a'), text('b'), text('c')])).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the NIST million-a known answer', () => {
    expect(sha256Hex([new Uint8Array(1_000_000).fill('a'.charCodeAt(0))])).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('matches the platform SHA-256 over arbitrary bytes and chunk boundaries', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 16_384 }),
        fc.integer({ min: 1, max: 257 }),
        (bytes, chunkSize) => {
          const parts: Uint8Array[] = [];
          for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            parts.push(bytes.subarray(offset, offset + chunkSize));
          }
          expect(sha256Hex(parts)).toBe(createHash('sha256').update(bytes).digest('hex'));
        },
      ),
      { numRuns: 100 },
    );
  });
});
