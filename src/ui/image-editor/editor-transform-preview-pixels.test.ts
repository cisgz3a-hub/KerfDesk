import { describe, expect, it } from 'vitest';
import { transformPreviewPixels } from './editor-transform-preview-pixels';

const MAX_BYTE = 255;
const HALF_BYTE = 128;

describe('transformPreviewPixels', () => {
  it('multiplies intrinsic pixel alpha by selection alpha without mutating the source', () => {
    const source = new Uint8ClampedArray([0, MAX_BYTE, 0, 0, 10, 20, 30, HALF_BYTE]);
    const result = transformPreviewPixels(source, new Uint8Array([MAX_BYTE, HALF_BYTE]));
    expect(Array.from(result)).toEqual([0, MAX_BYTE, 0, 0, 10, 20, 30, 64]);
    expect(Array.from(source)).toEqual([0, MAX_BYTE, 0, 0, 10, 20, 30, HALF_BYTE]);
  });
});
