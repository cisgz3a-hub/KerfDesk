import { describe, expect, it } from 'vitest';
import { vcarveIncludedAngleDeg } from '../cnc/vcarve-angle';
import type { CncTool } from '../scene';
import { cuttingSurfaceDz } from './tool-kernels';

// An engraving bit is a TRUNCATED cone. The simulator used to model it as a
// flat disc across the full diameter while the CAM planned it as a cone
// (vcarve-angle.ts), so the 3D preview showed a flat bottom for a job the
// machine cut as a V. These tests pin the two together.

function engraver(tipAngleDeg: number, tipDiameterMm?: number): CncTool {
  return {
    id: 'eng',
    name: `${tipAngleDeg}deg engraver`,
    kind: 'engraving',
    diameterMm: 3.175,
    tipAngleDeg,
    ...(tipDiameterMm === undefined ? {} : { tipDiameterMm }),
  };
}

const RADIUS_MM = 3.175 / 2;

describe('cuttingSurfaceDz — engraving bits', () => {
  it('rises as a cone, not a flat disc', () => {
    const tool = engraver(90);
    // 90° included angle → tan(45°) = 1 → dz equals the radial distance.
    expect(cuttingSurfaceDz(tool, 0, RADIUS_MM)).toBeCloseTo(0, 9);
    expect(cuttingSurfaceDz(tool, 0.5, RADIUS_MM)).toBeCloseTo(0.5, 9);
    expect(cuttingSurfaceDz(tool, 1, RADIUS_MM)).toBeCloseTo(1, 9);
  });

  it('stays flat across the tip land, then rises', () => {
    const tool = engraver(90, 0.4); // 0.2 mm tip radius
    expect(cuttingSurfaceDz(tool, 0, RADIUS_MM)).toBe(0);
    expect(cuttingSurfaceDz(tool, 0.2, RADIUS_MM)).toBeCloseTo(0, 9);
    expect(cuttingSurfaceDz(tool, 0.7, RADIUS_MM)).toBeCloseTo(0.5, 9);
  });

  it('never returns a negative height inside the tip land', () => {
    const tool = engraver(30, 1);
    for (const d of [0, 0.1, 0.25, 0.49]) {
      expect(cuttingSurfaceDz(tool, d, RADIUS_MM)).toBe(0);
    }
  });

  it('uses the same 60° fallback the CAM uses when the angle is unknown', () => {
    // vcarveIncludedAngleDeg falls back to 60° for an engraving bit with no
    // valid angle; the kernel must not disagree, or preview and cut diverge.
    const noAngle: CncTool = { id: 'e', name: 'e', kind: 'engraving', diameterMm: 3.175 };
    expect(vcarveIncludedAngleDeg(noAngle)).toBe(60);
    const expected = 1 / Math.tan((60 / 2) * (Math.PI / 180));
    expect(cuttingSurfaceDz(noAngle, 1, RADIUS_MM)).toBeCloseTo(expected, 9);
  });

  it('matches a v-bit of the same angle when the tip is a true point', () => {
    const angleDeg = 60;
    const vbit: CncTool = {
      id: 'v',
      name: 'v',
      kind: 'v-bit',
      diameterMm: 3.175,
      tipAngleDeg: angleDeg,
    };
    for (const d of [0.1, 0.5, 1, 1.5]) {
      expect(cuttingSurfaceDz(engraver(angleDeg), d, RADIUS_MM)).toBeCloseTo(
        cuttingSurfaceDz(vbit, d, RADIUS_MM),
        9,
      );
    }
  });

  it('leaves end-mill and ball-nose untouched', () => {
    const endMill: CncTool = { id: 'em', name: 'em', kind: 'end-mill', diameterMm: 3.175 };
    expect(cuttingSurfaceDz(endMill, 1, RADIUS_MM)).toBe(0);

    const ball: CncTool = { id: 'bn', name: 'bn', kind: 'ball-nose', diameterMm: 3.175 };
    expect(cuttingSurfaceDz(ball, 0, RADIUS_MM)).toBeCloseTo(0, 9);
    expect(cuttingSurfaceDz(ball, RADIUS_MM, RADIUS_MM)).toBeCloseTo(RADIUS_MM, 9);
  });
});
