// Surfacing generator (ADR-103 G8): serpentine coverage, depth ladder,
// spindle bracketing, and determinism.

import { describe, expect, it } from 'vitest';
import { buildSurfacingProgram, surfacingRowYs, type SurfacingParams } from './surfacing';

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
    const rows = surfacingRowYs(50, 10.16);
    expect(rows[0]).toBe(0);
    expect(rows.at(-1)).toBe(50);
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1];
      const curr = rows[i];
      if (prev === undefined || curr === undefined) throw new Error('row missing');
      expect(curr - prev).toBeLessThanOrEqual(10.16 + 1e-9);
    }
  });
});

describe('buildSurfacingProgram', () => {
  it('brackets motion with spin-up and M5, ends parked at the origin', () => {
    const program = buildSurfacingProgram(PARAMS);
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
    const program = buildSurfacingProgram(PARAMS);
    // 0.5, 1.0, then the 1.2 clamp.
    expect(program.passes).toBe(3);
    const plunges = program.lines.filter((line) => line.startsWith('G1 Z-'));
    expect(plunges).toEqual(['G1 Z-0.500 F600.000', 'G1 Z-1.000 F600.000', 'G1 Z-1.200 F600.000']);
  });

  it('serpentines: alternating X targets, monotonic Y steps', () => {
    const program = buildSurfacingProgram(PARAMS);
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
    expect(buildSurfacingProgram(PARAMS).lines.join('\n')).toBe(
      buildSurfacingProgram(PARAMS).lines.join('\n'),
    );
  });
});

describe('surfacing finite guards (D-S04-001)', () => {
  it('terminates on an Infinity height, returning a finite row array', () => {
    const rows = surfacingRowYs(Number.POSITIVE_INFINITY, 10);
    expect(rows.every((y) => Number.isFinite(y))).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('falls back to the min-step spacing when step is NaN or zero', () => {
    const nanStep = surfacingRowYs(0.2, Number.NaN);
    const zeroStep = surfacingRowYs(0.2, 0);
    // MIN_STEP_MM = 0.05 → 0, 0.05, 0.1, 0.15, then the 0.2 far-edge clamp.
    expect(nanStep).toEqual(zeroStep);
    for (let i = 1; i < nanStep.length; i += 1) {
      const prev = nanStep[i - 1];
      const curr = nanStep[i];
      if (prev === undefined || curr === undefined) throw new Error('row missing');
      expect(curr - prev).toBeLessThanOrEqual(0.05 + 1e-9);
    }
    expect(nanStep.at(-1)).toBe(0.2);
  });

  it('clamps a finite sub-MIN depth-per-pass to MIN_STEP_MM instead of exploding the pass count', () => {
    // 0.02 mm/pass is below MIN_STEP_MM (0.05); it must clamp to 0.05 and emit
    // the exact same program as a 0.05 mm pass — not pass through and mint ~25
    // fine passes. Regression guard for AF-CORE-001, where depthLadder dropped
    // its Math.max clamp (finitePositiveOr let finite sub-0.05 through).
    const clamped = buildSurfacingProgram({ ...PARAMS, depthPerPassMm: 0.02, totalDepthMm: 0.5 });
    const atMin = buildSurfacingProgram({ ...PARAMS, depthPerPassMm: 0.05, totalDepthMm: 0.5 });
    expect(clamped.passes).toBe(atMin.passes);
    expect(clamped.lines).toEqual(atMin.lines);
    // Must NOT be the unclamped fine-pass explosion (~25 passes at 0.02 mm).
    expect(clamped.passes).toBeLessThan(15);
  });

  it('does not hang on a tiny finite step — floors it at MIN_STEP_MM (AF-CORE-002)', () => {
    // 1e-20 is finite-positive, so the old guard let it through; once y/step
    // exceeds 2^53 the loop never advances. Flooring the step bounds it.
    const rows = surfacingRowYs(10, 1e-20);
    expect(rows.length).toBeLessThanOrEqual(10 / 0.05 + 2);
    expect(rows.every((y) => Number.isFinite(y))).toBe(true);
  });

  it('caps the row count for a pathological finite height so it cannot OOM', () => {
    const rows = surfacingRowYs(1e12, 0.05);
    expect(rows.length).toBeLessThanOrEqual(100_001);
  });

  it('emits no NaN or Infinity when every param is non-finite', () => {
    const program = buildSurfacingProgram({
      widthMm: Number.POSITIVE_INFINITY,
      heightMm: Number.NaN,
      bitDiameterMm: Number.NaN,
      stepoverPct: Number.NaN,
      depthPerPassMm: Number.NaN,
      totalDepthMm: Number.POSITIVE_INFINITY,
      feedMmPerMin: Number.NaN,
      plungeMmPerMin: Number.NEGATIVE_INFINITY,
      spindleRpm: Number.NaN,
      spindleSpinupSec: Number.POSITIVE_INFINITY,
      safeZMm: Number.NaN,
    });
    const text = program.lines.join('\n');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('Infinity');
  });
});
