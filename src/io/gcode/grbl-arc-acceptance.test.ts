import { describe, expect, it } from 'vitest';
import { parseGcodeProgram } from './parse-gcode-program';

// Independent numeric cases for tagged stock GRBL 1.1h gcode.c, lines 685-688
// and 727-738. These check acceptance rules; they do not execute firmware.
describe('stock GRBL external arc acceptance (O4)', () => {
  it.each([
    [1, 1.004, 'ok'],
    [1, 1.006, 'error'],
    [10, 10.009, 'ok'],
    [10, 10.011, 'error'],
    [10, 10.1, 'error'],
    [1000, 1000.499, 'ok'],
    [1000, 1000.501, 'error'],
    [10, 9.9, 'error'],
  ] as const)('IJ starting radius %s and ending radius %s: %s', (start, end, kind) => {
    const parsed = parseGcodeProgram(`G21 G90\nG0 X${start} Y0\nG3 X0 Y${end} I${-start} J0 F300`);
    expect(parsed.kind).toBe(kind);
    if (parsed.kind === 'error') expect(parsed.reason).toContain('arc radius mismatch');
  });

  it.each([9.99, -9.99])('rejects a 20 mm chord with R%s without drawing a clamped arc', (r) => {
    const parsed = parseGcodeProgram(`G21 G90\nG0 X0 Y0\nG2 X20 Y0 R${r} F300`);
    expect(parsed).toMatchObject({ kind: 'error', reason: expect.stringContaining('too small') });
  });

  it.each(['G2', 'G3'])('accepts feasible minor/major/semicircle R arcs for %s', (motion) => {
    for (const r of [10, -10, 12, -12]) {
      const parsed = parseGcodeProgram(`G21 G90\nG0 X0 Y0\n${motion} X20 Y0 R${r} F300`);
      expect(parsed.kind).toBe('ok');
    }
  });

  it('applies millimetre thresholds after inch and incremental coordinate conversion', () => {
    const invalid = parseGcodeProgram('G20 G90\nG0 X1 Y0\nG91\nG3 X-1 Y1.004 I-1 J0 F10');
    const valid = parseGcodeProgram('G20 G90\nG0 X1 Y0\nG91\nG3 X-1 Y1.0001 I-1 J0 F10');
    expect(invalid.kind).toBe('error');
    expect(valid.kind).toBe('ok');
  });

  it('preserves a native-style IJ helix with equal radii and changing depth', () => {
    const parsed = parseGcodeProgram('G21 G90\nG0 X10 Y0 Z0\nG3 X10 Y0 Z-1 I-10 J0 F300');
    expect(parsed.kind).toBe('ok');
    if (parsed.kind === 'ok') {
      const last = parsed.toolpath.steps.at(-1);
      expect(last?.kind).toBe('cut');
      if (last?.kind === 'cut') expect(last.z?.to).toBe(-1);
      expect(parsed.summary.cutMm).toBeCloseTo(20 * Math.PI, 1);
    }
  });
});
