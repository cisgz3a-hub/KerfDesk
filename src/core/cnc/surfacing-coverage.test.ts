import { describe, expect, it } from 'vitest';
import { buildSurfacingProgram } from './surfacing';

describe('surfacing nominal row coverage', () => {
  it('discloses emitted nominal gaps without blocking output', () => {
    const result = buildSurfacingProgram({
      widthMm: 100,
      heightMm: 100,
      bitDiameterMm: 25.4,
      stepoverPct: 200,
      depthPerPassMm: 0.5,
      totalDepthMm: 0.5,
      feedMmPerMin: 2500,
      plungeMmPerMin: 600,
      spindleRpm: 12000,
      spindleSpinupSec: 3,
      safeZMm: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const { program } = result;

    expect(program.planning.kind).toBe('complete');
    expect(program.outputPrecision).toBeNull();
    expect(program.coverage).toEqual({
      kind: 'nominal-gap',
      bitDiameterMm: 25.4,
      maxEmittedCenterGapMm: 50.8,
      nominalUncutGapMm: 25.4,
    });
    expect(program.lines[1]).toBe('; *** INCOMPLETE SURFACING PROGRAM: NOMINAL COVERAGE GAPS ***');
    expect(program.lines).toContain(
      '; nominal row coverage: bit 25.4 mm; largest emitted center gap 50.8 mm; nominal uncut gap 25.4 mm',
    );
    expect(program.lines).toContain('G1 Y50.800 F2500.000');
    expect(program.lines).toContain('G1 Y100.000 F2500.000');
  });
});
