import { describe, expect, it } from 'vitest';
import { buildSurfacingProgram } from '../../core/cnc/surfacing';
import { surfacingOverhangNote } from './SurfacingFields';

describe('surfacing overhang note (CNC audit v3 N4-P3-3)', () => {
  it('names the bit radius the cut reaches past each edge, the zero corner included', () => {
    expect(surfacingOverhangNote(25.4)).toContain('12.7 mm past every edge of the area');
    expect(surfacingOverhangNote(25.4)).toContain('left of and in front of the zero corner');
    expect(surfacingOverhangNote(6.35)).toContain('3.18 mm past every edge');
  });

  it('matches the program: the bit centre spans the whole area, from the zero corner', () => {
    const result = buildSurfacingProgram({
      widthMm: 300,
      heightMm: 200,
      bitDiameterMm: 25.4,
      stepoverPct: 40,
      depthPerPassMm: 0.5,
      totalDepthMm: 0.5,
      feedMmPerMin: 2500,
      plungeMmPerMin: 600,
      spindleRpm: 18000,
      spindleSpinupSec: 3,
      safeZMm: 5,
    });
    if (!result.ok) throw new Error(result.reason);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const line of result.program.lines) {
      const x = /X(-?\d+(?:\.\d+)?)/.exec(line);
      const y = /Y(-?\d+(?:\.\d+)?)/.exec(line);
      if (x !== null) xs.push(Number(x[1]));
      if (y !== null) ys.push(Number(y[1]));
    }
    // Centre at 0 and at the far edge: the 25.4 mm cutter's edge reaches
    // 12.7 mm beyond both, as the note says.
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(300);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(200);
  });
});
