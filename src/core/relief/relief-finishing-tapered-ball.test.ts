import { describe, expect, it } from 'vitest';
import { kernelForTool } from '../sim';
import type { CncTool } from '../scene';
import type { Heightmap } from './heightmap';
import {
  reliefFinishingPasses,
  reliefScallopBallRadiusMm,
  scallopRowSpacingMm,
} from './relief-finishing';

// ADR-368: a tapered ball nose finishes with its tip ball, and its flank keeps
// the finishing tip out of anything narrower than the taper at that depth.
const TBN: CncTool = {
  id: 'tbn',
  name: 'Tapered ball nose',
  kind: 'tapered-ball-nose',
  diameterMm: 6.25,
  tipAngleDeg: 10.8,
  tipDiameterMm: 1.5875,
};
const TIP_BALL: CncTool = { id: 'tip', name: 'tip ball', kind: 'ball-nose', diameterMm: 1.5875 };

describe('tapered ball-nose finishing', () => {
  it('spaces rows by the tip ball, not the widest diameter', () => {
    const tipRadius = 1.5875 / 2;
    expect(reliefScallopBallRadiusMm(TBN)).toBe(tipRadius);
    expect(scallopRowSpacingMm(TBN, 0.025)).toBeCloseTo(
      2 * Math.sqrt(0.025 * (2 * tipRadius - 0.025)),
      12,
    );
    // The requested cusp clamps to the tip radius, like a ball nose's.
    expect(scallopRowSpacingMm(TBN, 5)).toBeCloseTo(2 * tipRadius, 12);
    expect(scallopRowSpacingMm(TBN, 0.025)).toBe(scallopRowSpacingMm(TIP_BALL, 0.025));
  });

  it('plans incomplete geometry as the flat cylinder its kernel falls back to', () => {
    const { tipDiameterMm: _tip, ...noTip } = TBN;
    expect(reliefScallopBallRadiusMm(noTip)).toBeNull();
    expect(scallopRowSpacingMm(noTip, 0.025)).toBeCloseTo(6.25 * 0.4, 12);
    expect(reliefScallopBallRadiusMm({ ...TBN, kind: 'ball-nose' })).toBe(3.125);
    expect(reliefScallopBallRadiusMm({ ...TBN, kind: 'end-mill' })).toBeNull();
  });

  it('keeps the tip up where the flank meets the rim of a narrow deep slot', () => {
    // A 2 mm wide, 10 mm deep slot. The tip ball fits inside it, but 1 mm out
    // from the axis the taper is only about 2.94 mm above the tip, so a cutter
    // centred in the slot must stop about that far below the rim.
    const map = slotMap();
    const flankStop = 2.94;
    const tapered = deepestFinishingZ(map, TBN);
    const ballOnly = deepestFinishingZ(map, TIP_BALL);

    expect(tapered).toBeGreaterThanOrEqual(-flankStop - 0.01);
    expect(tapered).toBeLessThan(-flankStop + 0.2);
    expect(ballOnly).toBeCloseTo(-10, 6);
  });
});

function slotMap(): Heightmap {
  const cells = 60;
  const mmPerCell = 0.1;
  const depth = new Float32Array(cells * cells);
  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      const x = (col + 0.5) * mmPerCell;
      depth[row * cells + col] = Math.abs(x - 3) < 1 ? -10 : 0;
    }
  }
  return {
    widthCells: cells,
    heightCells: cells,
    widthMm: cells * mmPerCell,
    heightMm: cells * mmPerCell,
    mmPerCell,
    depth,
  };
}

function deepestFinishingZ(map: Heightmap, tool: CncTool): number {
  const passes = reliefFinishingPasses(map, {
    tool,
    kernel: kernelForTool(tool, map.mmPerCell),
    scallopMm: 0.025,
  });
  let deepest = 0;
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    for (const point of pass.points) deepest = Math.min(deepest, point.z);
  }
  return deepest;
}
