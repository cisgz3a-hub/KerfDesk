import { describe, expect, it } from 'vitest';
import { meshToHeightmap } from '../../core/relief';
import type { ParseStlResult } from '../../io/stl';
import { prepareParsedStlImport } from './stl-import-preparation';

const options = { targetWidthMm: 100, reliefDepthMm: 5, mmPerCell: 1 };

describe('prepareParsedStlImport', () => {
  it('stores the mesh in the canvas frame and derives the relief aspect ratio', () => {
    const positions = Float32Array.from([0, 0, 0, 2, 0, 0, 0, 1, 1]);
    const parsed: ParseStlResult = {
      kind: 'ok',
      mesh: { positions },
      format: 'binary',
    };
    const result = prepareParsedStlImport(parsed, options);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.positions).toBeInstanceOf(Float32Array);
    expect(Array.from(result.positions)).toEqual([0, 0, 0, 2, 0, 0, 0, -1, 1]);
    expect(Object.is(result.positions[1], -0)).toBe(false);
    expect(result.widthMm).toBe(100);
    expect(result.heightMm).toBe(50);
  });

  it('keeps a Float64-backed mesh Float64-backed', () => {
    const positions = Float64Array.from([0, 0, 0, 2, 0, 0, 0, 1, 1]);
    const result = prepareParsedStlImport(
      { kind: 'ok', mesh: { positions }, format: 'ascii' },
      options,
    );
    expect(result.kind === 'ok' && result.positions instanceof Float64Array).toBe(true);
  });

  // ADR-414: seen from above, a CAD model's +Y (its back) is the top of the
  // canvas, which is the first heightmap row and the back of the machine.
  it('keeps the CAD top view: the back of the model lands on the first row', () => {
    // A ramp rising toward +Y: low at the model's front, high at its back.
    const ramp = Float32Array.from([0, 0, 0, 10, 0, 0, 10, 10, 10, 0, 0, 0, 10, 10, 10, 0, 10, 10]);
    const result = prepareParsedStlImport(
      { kind: 'ok', mesh: { positions: ramp }, format: 'binary' },
      { targetWidthMm: 10, reliefDepthMm: 5, mmPerCell: 1 },
    );
    if (result.kind !== 'ok') throw new Error('expected ok');
    const map = meshToHeightmap(
      { positions: result.positions },
      { targetWidthMm: 10, reliefDepthMm: 5, mmPerCell: 1 },
    );
    if (map.kind !== 'ok') throw new Error(map.reason);
    const { depth, widthCells, heightCells } = map.heightmap;
    const firstRow = depth[5] ?? Number.NaN;
    const lastRow = depth[(heightCells - 1) * widthCells + 5] ?? Number.NaN;
    expect(firstRow).toBeGreaterThan(-0.5);
    expect(lastRow).toBeLessThan(-4.5);
  });

  it('preserves parser errors', () => {
    expect(prepareParsedStlImport({ kind: 'error', reason: 'broken STL' }, options)).toEqual({
      kind: 'error',
      reason: 'broken STL',
    });
  });
});
