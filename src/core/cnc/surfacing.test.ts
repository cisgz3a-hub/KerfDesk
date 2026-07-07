// Surfacing generator (ADR-103 G8): serpentine coverage, depth ladder,
// spindle bracketing, and determinism.

import { describe, expect, it } from 'vitest';
import {
  buildSurfacingProgram,
  surfacingRowYs,
  type SurfacingParams,
  type SurfacingProgram,
  type SurfacingProgramResult,
  type SurfacingRowsResult,
} from './surfacing';

const PARAMS: SurfacingParams = {
  widthMm: 100,
  heightMm: 50,
  bitDiameterMm: 25.4,
  stepoverPct: 40,
  depthPerPassMm: 0.5,
  totalDepthMm: 1.2,
  feedMmPerMin: 2500,
  plungeMmPerMin: 600,
  spindleRpm: 12000,
  spindleSpinupSec: 3,
  safeZMm: 5,
};

describe('surfacingRowYs', () => {
  it('covers 0..height inclusive with the far edge exact', () => {
    const rows = expectSurfacingRows(surfacingRowYs(50, 10.16));
    expect(rows[0]).toBe(0);
    expect(rows.at(-1)).toBe(50);
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1];
      const curr = rows[i];
      if (prev === undefined || curr === undefined) throw new Error('row missing');
      expect(curr - prev).toBeLessThanOrEqual(10.16 + 1e-9);
    }
  });

  it('rejects non-finite row spacing instead of silently accepting it', () => {
    expect(surfacingRowYs(50, Number.NaN)).toEqual({
      ok: false,
      reason: 'Surfacing step must be a positive finite number.',
    });
  });
});

describe('buildSurfacingProgram', () => {
  it('brackets motion with spin-up and M5, ends parked at the origin', () => {
    const program = expectSurfacingProgram(buildSurfacingProgram(PARAMS));
    const lines = program.lines;
    expect(lines).toContain('M3 S12000');
    expect(lines).toContain('G4 P3.000');
    expect(lines.at(-2)).toBe('M5');
    expect(lines.at(-1)).toBe('G0 X0.000 Y0.000');
    // Spindle starts before any motion below safe Z.
    expect(lines.indexOf('M3 S12000')).toBeLessThan(
      lines.findIndex((line) => line.startsWith('G1 Z-')),
    );
  });

  it('ladders depth per pass and clamps the final pass to the total', () => {
    const program = expectSurfacingProgram(buildSurfacingProgram(PARAMS));
    // 0.5, 1.0, then the 1.2 clamp.
    expect(program.passes).toBe(3);
    const plunges = program.lines.filter((line) => line.startsWith('G1 Z-'));
    expect(plunges).toEqual(['G1 Z-0.500 F600.000', 'G1 Z-1.000 F600.000', 'G1 Z-1.200 F600.000']);
  });

  it('serpentines: alternating X targets, monotonic Y steps', () => {
    const program = expectSurfacingProgram(buildSurfacingProgram(PARAMS));
    const plungeIndex = program.lines.indexOf('G1 Z-0.500 F600.000');
    const retractIndex = program.lines.findIndex(
      (line, index) => index > plungeIndex && line === 'G0 Z5.000',
    );
    const firstPass = program.lines.slice(plungeIndex + 1, retractIndex);
    const xTargets = firstPass
      .filter((line) => line.startsWith('G1 X'))
      .map((line) => Number(/X(-?[\d.]+)/.exec(line)?.[1]));
    for (let i = 1; i < xTargets.length; i += 1) {
      expect(xTargets[i]).not.toBe(xTargets[i - 1]);
    }
    const yTargets = firstPass
      .filter((line) => line.startsWith('G1 Y'))
      .map((line) => Number(/Y(-?[\d.]+)/.exec(line)?.[1]));
    expect(yTargets.at(-1)).toBe(50);
    expect([...yTargets].sort((a, b) => a - b)).toEqual(yTargets);
  });

  it('is byte-deterministic', () => {
    expect(expectSurfacingProgram(buildSurfacingProgram(PARAMS)).lines.join('\n')).toBe(
      expectSurfacingProgram(buildSurfacingProgram(PARAMS)).lines.join('\n'),
    );
  });

  it('rejects non-finite dimensions before formatting G-code', () => {
    expect(buildSurfacingProgram({ ...PARAMS, widthMm: Number.NaN })).toEqual({
      ok: false,
      reason: 'Surfacing width must be a positive finite number.',
    });
  });
});

function expectSurfacingRows(result: SurfacingRowsResult): ReadonlyArray<number> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.rows;
}

function expectSurfacingProgram(result: SurfacingProgramResult): SurfacingProgram {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.program;
}
