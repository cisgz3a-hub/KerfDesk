import { describe, expect, it } from 'vitest';
import type { ParseStlResult } from '../../io/stl';
import { prepareParsedStlImport } from './stl-import-preparation';

const options = { targetWidthMm: 100, reliefDepthMm: 5, mmPerCell: 1 };

describe('prepareParsedStlImport', () => {
  it('keeps the typed mesh and derives the relief aspect ratio', () => {
    const positions = Float32Array.from([0, 0, 0, 2, 0, 0, 0, 1, 1]);
    const parsed: ParseStlResult = {
      kind: 'ok',
      mesh: { positions },
      format: 'binary',
    };
    const result = prepareParsedStlImport(parsed, options);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.positions).toBe(positions);
    expect(result.widthMm).toBe(100);
    expect(result.heightMm).toBe(50);
  });

  it('preserves parser errors', () => {
    expect(prepareParsedStlImport({ kind: 'error', reason: 'broken STL' }, options)).toEqual({
      kind: 'error',
      reason: 'broken STL',
    });
  });
});
