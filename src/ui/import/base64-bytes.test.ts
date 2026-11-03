import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from './base64-bytes';

describe('bytesToBase64', () => {
  it('matches canonical encoding across the worker-safe chunk boundary', () => {
    const bytes = Uint8Array.from({ length: 48 * 1024 + 5 }, (_, index) => index & 0xff);

    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('gives the same text on the chunked route an engine without toBase64 takes', () => {
    for (const length of [0, 1, 2, 3, 48 * 1024, 3 * 48 * 1024 + 2]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) & 0xff);
      Object.defineProperty(bytes, 'toBase64', { value: undefined });

      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});
