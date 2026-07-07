import { describe, expect, it } from 'vitest';
import { pngDataUrlToBlob } from './png-encode';

describe('pngDataUrlToBlob', () => {
  it('decodes a base64 PNG data URL into a typed blob', () => {
    const blob = pngDataUrlToBlob('data:image/png;base64,QUJD'); // "ABC"
    expect(blob).not.toBeNull();
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBe(3); // jsdom's Blob has no .text(); size pins the payload
  });

  it('rejects non-PNG data URLs and malformed base64', () => {
    expect(pngDataUrlToBlob('data:image/jpeg;base64,QUJD')).toBeNull();
    expect(pngDataUrlToBlob('data:image/png;base64,%%%')).toBeNull();
    expect(pngDataUrlToBlob('')).toBeNull();
  });
});
