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

const ORDINARY_40_PERCENT_OUTPUT = `; KerfDesk spoilboard surfacing
; area 100.000 x 50.000 mm, bit 25.400 mm, stepover 40%
; zero X/Y at the front-left corner of the area, Z0 on the surface to face
G21
G90
G54
G94
G17
G0 Z5.000
M3 S12000
G4 P3.000
G0 X0.000 Y0.000
G1 Z-0.500 F600.000
G1 X100.000 F2500.000
G1 Y10.160 F2500.000
G1 X0.000 F2500.000
G1 Y20.320 F2500.000
G1 X100.000 F2500.000
G1 Y30.480 F2500.000
G1 X0.000 F2500.000
G1 Y40.640 F2500.000
G1 X100.000 F2500.000
G1 Y50.000 F2500.000
G1 X0.000 F2500.000
G0 Z5.000
G0 X0.000 Y0.000
G1 Z-1.000 F600.000
G1 X100.000 F2500.000
G1 Y10.160 F2500.000
G1 X0.000 F2500.000
G1 Y20.320 F2500.000
G1 X100.000 F2500.000
G1 Y30.480 F2500.000
G1 X0.000 F2500.000
G1 Y40.640 F2500.000
G1 X100.000 F2500.000
G1 Y50.000 F2500.000
G1 X0.000 F2500.000
G0 Z5.000
G0 X0.000 Y0.000
G1 Z-1.200 F600.000
G1 X100.000 F2500.000
G1 Y10.160 F2500.000
G1 X0.000 F2500.000
G1 Y20.320 F2500.000
G1 X100.000 F2500.000
G1 Y30.480 F2500.000
G1 X0.000 F2500.000
G1 Y40.640 F2500.000
G1 X100.000 F2500.000
G1 Y50.000 F2500.000
G1 X0.000 F2500.000
G0 Z5.000
M5
G0 X0.000 Y0.000`;

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

  it('reports bounded pass-limit evidence for a pathological finite row count', () => {
    // The exact 0.05 mm step remains intact; bounded work is disclosed as evidence.
    const result = surfacingRowYs(1e12, 0.05);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(100_000);
    expect(result.termination).toEqual({ kind: 'pass-limit', passLimit: 100_000 });
  });
});

describe('buildSurfacingProgram', () => {
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

  it('keeps ordinary 40% output byte-identical while exposing complete evidence', () => {
    const program = expectSurfacingProgram(buildSurfacingProgram(PARAMS));
    expect(program.lines.join('\n')).toBe(ORDINARY_40_PERCENT_OUTPUT);
    expect(program.planning).toEqual({
      kind: 'complete',
      stepoverPct: 40,
      stepMm: 10.16,
      generatedRowsPerPass: 6,
      generatedPasses: 3,
      generatedRouteRows: 18,
    });
    expect(program.coverage).toEqual({ kind: 'nominal-complete', maxEmittedCenterGapMm: 10.16 });
    expect(program.outputPrecision).toBeNull();
  });

  it.each([
    { stepoverPct: 1, stepMm: 0.254, rowsPerPass: 5 },
    { stepoverPct: 200, stepMm: 50.8, rowsPerPass: 2 },
  ])('preserves exact positive $stepoverPct% Stepover', ({ stepoverPct, stepMm, rowsPerPass }) => {
    const program = expectSurfacingProgram(
      buildSurfacingProgram({
        ...PARAMS,
        heightMm: 1,
        stepoverPct,
        depthPerPassMm: 0.5,
        totalDepthMm: 0.5,
      }),
    );
    expect(program.rowsPerPass).toBe(rowsPerPass);
    expect(program.lines[1]).toContain(`stepover ${stepoverPct}%`);
    expect(program.planning).toMatchObject({
      kind: 'complete',
      stepoverPct,
      stepMm,
    });
  });

  it('preserves exact 0.001% Stepover and reports bounded incomplete work', () => {
    const program = expectSurfacingProgram(
      buildSurfacingProgram({ ...PARAMS, stepoverPct: 0.001 }),
    );
    expect(program.lines).toContain('; area 100.000 x 50.000 mm, bit 25.400 mm, stepover 0.001%');
    expect(program.planning).toMatchObject({
      kind: 'pass-limit',
      stepoverPct: 0.001,
      stepMm: 0.000254,
      generatedRowsPerPass: 100_000,
      generatedPasses: 1,
      generatedRouteRows: 100_000,
      passLimit: 100_000,
      limitedStages: ['rows', 'depth-passes'],
      requestedYCoverageMm: 50,
      requestedDepthMm: 1.2,
      achievedDepthMm: 0.5,
    });
    if (program.planning.kind !== 'pass-limit') return;
    expect(program.planning.achievedYCoverageMm).toBe(25.4);
    expect(program.outputPrecision).toMatchObject({
      kind: 'output-precision',
      affectedFields: ['y-coordinates'],
      requestedRowStepMm: 0.000254,
      achievedYExtentMm: 25.4,
      plannedRows: 100_000,
      distinctEmittedYCoordinates: 25_401,
    });
    expect(program.lines[1]).toBe(
      '; *** INCOMPLETE SURFACING PROGRAM: PASS LIMIT REACHED + OUTPUT VALUES DIFFER ***',
    );
    expect(program.lines).toContain(
      '; requested Y coverage: 50.000 mm; achieved Y coverage: 25.400 mm',
    );
    expect(program.lines).toContain(
      '; output Y step: requested 0.000254 mm; 100000 planned / 25401 emitted coordinates',
    );
    expect(program.lines.filter((line) => line.startsWith('G1 Y')).at(-1)).toBe(
      'G1 Y25.400 F2500.000',
    );
  });

  it('preserves exact positive depth and stepdown below the former 0.05 mm floor', () => {
    const program = expectSurfacingProgram(
      buildSurfacingProgram({
        ...PARAMS,
        heightMm: 1,
        stepoverPct: 200,
        depthPerPassMm: 0.01,
        totalDepthMm: 0.025,
      }),
    );
    expect(program.passes).toBe(3);
    expect(program.lines.filter((line) => line.startsWith('G1 Z-'))).toEqual([
      'G1 Z-0.010 F600.000',
      'G1 Z-0.020 F600.000',
      'G1 Z-0.025 F600.000',
    ]);
    expect(program.outputPrecision).toBeNull();
  });

  it('persists every demonstrated sub-quantum X/Y/Z/F/S output difference', () => {
    const program = expectSurfacingProgram(
      buildSurfacingProgram({
        ...PARAMS,
        widthMm: 0.0001,
        heightMm: 0.0001,
        stepoverPct: 200,
        depthPerPassMm: 0.0004,
        totalDepthMm: 0.0012,
        feedMmPerMin: 0.0001,
        plungeMmPerMin: 0.0001,
        spindleRpm: 0.4,
        spindleSpinupSec: 0.0001,
        safeZMm: 0.0001,
      }),
    );

    expect(program.planning.kind).toBe('complete');
    expect(program.outputPrecision).toMatchObject({
      kind: 'output-precision',
      affectedFields: [
        'x-extent',
        'y-coordinates',
        'safe-z',
        'feed',
        'plunge-feed',
        'spindle-rpm',
        'spindle-spinup',
        'depth-levels',
      ],
      requestedWidthMm: 0.0001,
      achievedWidthMm: 0,
      achievedYExtentMm: 0,
      plannedRows: 2,
      distinctEmittedYCoordinates: 1,
      requestedSafeZMm: 0.0001,
      achievedSafeZMm: 0,
      requestedFeedMmPerMin: 0.0001,
      achievedFeedMmPerMin: 0,
      requestedPlungeMmPerMin: 0.0001,
      achievedPlungeMmPerMin: 0,
      requestedSpindleRpm: 0.4,
      achievedSpindleRpm: 0,
      requestedSpindleSpinupSec: 0.0001,
      achievedSpindleSpinupSec: 0,
      requestedDepthPerPassMm: 0.0004,
      achievedDeepestDepthMm: 0.001,
      plannedDepthLevels: 3,
      distinctEmittedDepthCoordinates: 2,
    });
    expect(program.lines[1]).toBe('; *** INCOMPLETE SURFACING PROGRAM: OUTPUT VALUES DIFFER ***');
    expect(program.lines).toEqual(
      expect.arrayContaining([
        '; output X extent: requested 0.0001 mm; achieved 0.000 mm',
        '; output Y extent: planned 0.0001 mm; achieved 0.000 mm',
        '; output safe Z: requested 0.0001 mm; achieved Z0.000',
        '; output feed: requested 0.0001 mm/min; achieved F0.000',
        '; output plunge: requested 0.0001 mm/min; achieved F0.000',
        '; output spindle: requested 0.4 RPM; achieved S0',
        '; output spin-up: requested 0.0001 s; achieved P0.000',
        '; output depth: planned 0.0012 mm; achieved 0.001 mm',
        '; output stepdown: requested 0.0004 mm; 3 planned / 2 emitted Z levels',
        'M3 S0',
        'G4 P0.000',
        'G0 Z0.000',
        'G1 X0.000 F0.000',
        'G1 Y0.000 F0.000',
      ]),
    );
    expect(program.lines.filter((line) => line.startsWith('G1 Z'))).toEqual([
      'G1 Z0.000 F0.000',
      'G1 Z-0.001 F0.000',
      'G1 Z-0.001 F0.000',
    ]);
  });

  it('returns a bounded partial program with structured depth pass-limit evidence', () => {
    const program = expectSurfacingProgram(
      buildSurfacingProgram({ ...PARAMS, depthPerPassMm: 0.05, totalDepthMm: 1e12 }),
    );
    expect(program.planning).toMatchObject({
      kind: 'pass-limit',
      stepoverPct: 40,
      stepMm: 10.16,
      generatedRowsPerPass: 6,
      generatedPasses: 16_666,
      generatedRouteRows: 99_996,
      passLimit: 100_000,
      limitedStages: ['depth-passes'],
      requestedYCoverageMm: 50,
      achievedYCoverageMm: 50,
      requestedDepthMm: 1e12,
    });
    if (program.planning.kind !== 'pass-limit') return;
    expect(program.planning.achievedDepthMm).toBeCloseTo(833.3, 9);
    expect(program.outputPrecision).toBeNull();
    expect(program.lines.slice(0, 6)).toEqual([
      '; KerfDesk spoilboard surfacing',
      '; *** INCOMPLETE SURFACING PROGRAM: PASS LIMIT REACHED ***',
      '; requested Y coverage: 50.000 mm; achieved Y coverage: 50.000 mm',
      '; requested depth: 1000000000000.000 mm; achieved depth: 833.300 mm',
      '; area 100.000 x 50.000 mm, bit 25.400 mm, stepover 40%',
      '; zero X/Y at the front-left corner of the area, Z0 on the surface to face',
    ]);
    expect(program.lines.filter((line) => line.startsWith('G1 Z-')).at(-1)).toBe(
      'G1 Z-833.300 F600.000',
    );
    expect(program.lines).not.toContain('G1 Z-1000000000000.000 F600.000');
  });

  it('rejects non-finite dimensions before formatting G-code', () => {
    expect(buildSurfacingProgram({ ...PARAMS, widthMm: Number.NaN })).toEqual({
      ok: false,
      reason: 'Surfacing width must be a positive finite number.',
    });
  });

  it('keeps zero and non-finite Stepover as factual integrity errors', () => {
    expect(buildSurfacingProgram({ ...PARAMS, stepoverPct: 0 })).toEqual({
      ok: false,
      reason: 'Surfacing stepover must be a positive finite number.',
    });
    expect(buildSurfacingProgram({ ...PARAMS, stepoverPct: Number.NaN })).toEqual({
      ok: false,
      reason: 'Surfacing stepover must be a positive finite number.',
    });
  });

  it('allows zero spin-up delay and omits the dwell', () => {
    const result = buildSurfacingProgram({ ...PARAMS, spindleSpinupSec: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program.lines.some((line) => line.startsWith('G4 P'))).toBe(false);
  });

  it('preserves a positive spin-up delay below the former floor', () => {
    const result = buildSurfacingProgram({ ...PARAMS, spindleSpinupSec: 0.499 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program.lines).toContain('G4 P0.499');
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
