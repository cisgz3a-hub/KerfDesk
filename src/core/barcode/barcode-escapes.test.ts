import { describe, expect, it } from 'vitest';
import { decodeBarcodeEscapes } from './barcode-escapes';
import { layoutBarcode } from './barcode-layout';
import { defaultBarcodeSpec } from './barcode-spec';

describe('barcode escape sequences', () => {
  it('turns the named escapes into control characters and keeps unknown ones', () => {
    expect(decodeBarcodeEscapes('A\\tB\\nC\\x1DD\\u0041\\\\E\\q')).toBe('A\tB\nC\u001dDA\\E\\q');
  });

  it('encodes the decoded data only when the option is on', () => {
    const spec = { ...defaultBarcodeSpec('code128'), data: 'A\\tB' };
    const plain = layoutBarcode(spec, spec.data);
    const escaped = layoutBarcode({ ...spec, processEscapes: true }, spec.data);
    expect(plain.ok && escaped.ok).toBe(true);
    // A literal backslash and t are two characters; the tab is one, so the code is shorter.
    if (plain.ok && escaped.ok) expect(escaped.layout.widthMm).toBeLessThan(plain.layout.widthMm);
  });
});
