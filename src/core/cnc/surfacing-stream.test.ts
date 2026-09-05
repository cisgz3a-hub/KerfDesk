import { describe, expect, it } from 'vitest';
import { buildSurfacingProgram, type SurfacingParams } from './surfacing';

const params: SurfacingParams = {
  widthMm: 100,
  heightMm: 9,
  bitDiameterMm: 1,
  stepoverPct: 100,
  depthPerPassMm: 0.5,
  totalDepthMm: 4.5,
  feedMmPerMin: 1000,
  plungeMmPerMin: 300,
  spindleRpm: 12000,
  spindleSpinupSec: 0,
  safeZMm: 5,
};

describe('replayable surfacing output', () => {
  it('does not materialize the row/pass product before a consumer requests lines', () => {
    const small = buildSurfacingProgram(params);
    if (!small.ok) throw new Error(small.reason);
    expect(Array.isArray(small.program.lines)).toBe(false);
    // This accepted product would otherwise allocate 20 billion strings.
    const large = buildSurfacingProgram({ ...params, heightMm: 99999, totalDepthMm: 49999.5 });
    if (!large.ok) throw new Error(large.reason);
    expect(large.program.rowsPerPass).toBe(100000);
    expect(large.program.passes).toBe(99999);
    const iterator = large.program.lines[Symbol.iterator]();
    const prefix = Array.from({ length: 16 }, () => iterator.next().value);
    expect(prefix).toContain('G1 Z-0.500 F300.000');
    expect(prefix).toContain('G1 X100.000 F1000.000');
    iterator.return?.();
  });

  it('replays identical complete bytes for preflight and saving from captured inputs', () => {
    const inputs = { ...params };
    const result = buildSurfacingProgram(inputs);
    if (!result.ok) throw new Error(result.reason);
    const first = [...result.program.lines];
    inputs.widthMm = 12345;
    expect([...result.program.lines]).toEqual(first);
    expect(first).toHaveLength(211);
    expect(first.slice(-2)).toEqual(['M5', 'G0 X0.000 Y0.000']);
  });
});
