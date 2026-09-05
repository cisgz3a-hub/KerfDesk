// Surfacing generator (ADR-103 G8): serpentine coverage, depth ladder,
// spindle bracketing, and determinism.

import { describe, expect, it } from 'vitest';
import { formatCncCoordinateMm } from './cnc-output-precision';
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

  it('rejects a pathological finite height instead of exhausting memory', () => {
    // 1e12 mm at the 0.05 mm minimum step is 2e13 rows — must error, not build.
    expect(surfacingRowYs(1e12, 0.05)).toEqual({
      ok: false,
      reason: 'Surfacing row count exceeds the 100000 limit.',
    });
  });
});

describe('buildSurfacingProgram', () => {
  it('preserves a positive stepover below the former 0.05 mm floor', () => {
    const program = expectSurfacingProgram(
      buildSurfacingProgram({
        ...PARAMS,
        heightMm: 0.025,
        bitDiameterMm: 1,
        stepoverPct: 1,
      }),
    );

    expect(program.rowsPerPass).toBe(4);
    expect(program.lines).toContain('G1 Y0.010 F2500.000');
    expect(program.lines).toContain('G1 Y0.020 F2500.000');
    expect(program.lines).toContain('G1 Y0.025 F2500.000');
  });

  it('clears the touched surface before spin-up, brackets cutting with M5, and parks', () => {
    const program = expectSurfacingProgram(buildSurfacingProgram(PARAMS));
    const lines = program.lines;
    expect(lines.slice(3, 8)).toEqual(['G21', 'G90', 'G54', 'G94', 'G17']);
    expect(lines).toContain('M3 S12000');
    expect(lines).toContain('G4 P3.000');
    expect(lines.at(-2)).toBe('M5');
    expect(lines.at(-1)).toBe('G0 X0.000 Y0.000');
    // Z0 touch-off leaves the cutter on the surface. The first motion must lift
    // it with the spindle off; only then may M3 and its dwell run.
    const firstMotion = lines.findIndex((line) => /^G[01]\b/.test(line));
    expect(lines[firstMotion]).toBe('G0 Z5.000');
    const spindleIndex = lines.indexOf('M3 S12000');
    const dwellIndex = lines.indexOf('G4 P3.000');
    const plungeIndex = lines.findIndex((line) => line.startsWith('G1 Z-'));
    expect(firstMotion).toBeLessThan(spindleIndex);
    expect(spindleIndex).toBeLessThan(dwellIndex);
    expect(dwellIndex).toBeLessThan(plungeIndex);
  });

  it('ladders depth per pass and clamps the final pass to the total', () => {
    const program = expectSurfacingProgram(buildSurfacingProgram(PARAMS));
    // 0.5, 1.0, then the 1.2 clamp.
    expect(program.passes).toBe(3);
    const plunges = program.lines.filter((line) => line.startsWith('G1 Z-'));
    expect(plunges).toEqual(['G1 Z-0.500 F600.000', 'G1 Z-1.000 F600.000', 'G1 Z-1.200 F600.000']);
  });

  it.each([
    [0.00049, 0],
    [0.0005, 0.001],
    [0.0006, 0.001],
    [0.001, 0.001],
    [0.01, 0.01],
    [0.049, 0.049],
    [0.05, 0.05],
    [0.05049, 0.05],
    [0.0505, 0.051],
    [0.051, 0.051],
  ] as const)(
    'discloses requested shallow total %s mm as emitted maximum %s mm',
    (totalDepthMm, emittedMaximumDepthMm) => {
      const program = expectSurfacingProgram(
        buildSurfacingProgram({
          ...PARAMS,
          depthPerPassMm: totalDepthMm / 2,
          totalDepthMm,
        }),
      );
      const depths = program.lines
        .filter((line) => line.startsWith('G1 Z'))
        .map((line) => Math.abs(Number(/Z(-?[\d.]+)/.exec(line)?.[1])));

      expect(program.requestedTotalDepthMm).toBe(totalDepthMm);
      expect(formatCncCoordinateMm(program.emittedMaximumDepthMm)).toBe(
        emittedMaximumDepthMm.toFixed(3),
      );
      expect(program.emittedMaximumDepthText).toBe(emittedMaximumDepthMm.toFixed(3));
      expect(Math.max(...depths).toFixed(3)).toBe(emittedMaximumDepthMm.toFixed(3));
      expect(program.lines).toContain(
        `; depth requested-total-mm: ${totalDepthMm}; emitted-maximum-mm: ${emittedMaximumDepthMm.toFixed(3)}`,
      );
    },
  );

  it('retains exact emitted depth text when GRBL float storage is not format-idempotent', () => {
    const program = expectSurfacingProgram(
      buildSurfacingProgram({
        ...PARAMS,
        depthPerPassMm: 6553.606,
        totalDepthMm: 6553.606,
      }),
    );

    expect(program.emittedMaximumDepthText).toBe('6553.606');
    expect(formatCncCoordinateMm(program.emittedMaximumDepthMm)).toBe('6553.605');
    expect(program.lines).toContain(
      '; depth requested-total-mm: 6553.606; emitted-maximum-mm: 6553.606',
    );
    expect(program.lines).toContain('G1 Z-6553.606 F600.000');
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

  it('rejects a pathological finite total depth instead of exhausting memory', () => {
    expect(buildSurfacingProgram({ ...PARAMS, depthPerPassMm: 0.05, totalDepthMm: 1e12 })).toEqual({
      ok: false,
      reason: 'Surfacing depth pass count exceeds the 100000 limit.',
    });
  });

  it('rejects non-finite dimensions before formatting G-code', () => {
    expect(buildSurfacingProgram({ ...PARAMS, widthMm: Number.NaN })).toEqual({
      ok: false,
      reason: 'Surfacing width must be a positive finite number.',
    });
  });

  it('allows zero spin-up delay and omits the dwell', () => {
    const result = buildSurfacingProgram({ ...PARAMS, spindleSpinupSec: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.program.lines].some((line) => line.startsWith('G4 P'))).toBe(false);
  });

  it('preserves a positive spin-up delay below the former floor', () => {
    const result = buildSurfacingProgram({ ...PARAMS, spindleSpinupSec: 0.499 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.program.lines]).toContain('G4 P0.499');
  });
});

function expectSurfacingRows(result: SurfacingRowsResult): ReadonlyArray<number> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.rows;
}

function expectSurfacingProgram(
  result: SurfacingProgramResult,
): Omit<SurfacingProgram, 'lines'> & { readonly lines: ReadonlyArray<string> } {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return { ...result.program, lines: [...result.program.lines] };
}
