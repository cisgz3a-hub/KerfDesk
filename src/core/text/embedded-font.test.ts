import { describe, expect, it } from 'vitest';
import type { EmbeddedFont } from '../scene';
import { embeddedFontBuffer, encodeEmbeddedFont, MAX_EMBEDDED_FONT_BYTES } from './embedded-font';

describe('embedded project fonts', () => {
  it('round-trips supported OpenType bytes', () => {
    const source = new Uint8Array([79, 84, 84, 79, 0, 1, 2, 3]);
    const font = encodeEmbeddedFont({
      key: 'embedded:studio',
      fileName: 'Studio.otf',
      buffer: source.buffer,
    });

    expect(new Uint8Array(embeddedFontBuffer(font))).toEqual(source);
  });

  it('rejects oversized and unsupported payloads', () => {
    expect(() =>
      encodeEmbeddedFont({
        key: 'embedded:large',
        fileName: 'large.ttf',
        buffer: new ArrayBuffer(MAX_EMBEDDED_FONT_BYTES + 1),
      }),
    ).toThrow(/project limit/);
    expect(() =>
      encodeEmbeddedFont({
        key: 'embedded:not-font',
        fileName: 'not-font.ttf',
        buffer: new Uint8Array([1, 2, 3, 4]).buffer,
      }),
    ).toThrow(/not a supported/);
  });

  it('validates a persisted font signature before use', () => {
    const font: EmbeddedFont = {
      key: 'embedded:bad',
      fileName: 'bad.otf',
      dataBase64: 'Tk9QRQ==',
    };
    expect(() => embeddedFontBuffer(font)).toThrow(/not a supported/);
  });
});
