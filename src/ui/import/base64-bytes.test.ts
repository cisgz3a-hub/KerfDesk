import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from './base64-bytes';

describe('bytesToBase64', () => {
  it('matches canonical encoding across the worker-safe chunk boundary', () => {
    const bytes = Uint8Array.from({ length: 48 * 1024 + 5 }, (_, index) => index & 0xff);

    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});
