import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type Origin } from '../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { computeCncRemovalGrid } from './cnc-removal-grid';
import { cncCut3DWorkFrame, registerCncCut3DWorkFrame } from './cnc-cut3d-work-frame';

const ORIGINS: ReadonlyArray<readonly [Origin, number, number]> = [
  ['front-left', 1, 1],
  ['front-right', -1, 1],
  ['rear-left', 1, -1],
  ['rear-right', -1, -1],
  ['center', 1, 1],
];

describe('Cut 3D work-frame registration', () => {
  for (const [origin, xSign, ySign] of ORIGINS) {
    it.each([
      { x: 0, y: 0 },
      { x: 123.5, y: -42.75 },
      { x: -200, y: 321.5 },
    ])(`keeps work zero and positive axes registered for ${origin} at %o`, (placement) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, origin, bedWidth: 431.75, bedHeight: 312.25 };
      for (const stockOrigin of [
        { x: 3.5, y: -7.5 },
        { x: -10.125, y: -6.25 },
      ]) {
        const stock = {
          ...DEFAULT_CNC_MACHINE_CONFIG.stock,
          widthMm: 20.25,
          heightMm: 12.5,
          originOffset: stockOrigin,
        };
        const grid = computeCncRemovalGrid(
          device,
          { ...DEFAULT_CNC_MACHINE_CONFIG, stock },
          { steps: [], totalLength: 0 },
          1,
          placement,
        );
        if (grid === null) throw new Error('Fixture stock did not produce a removal grid');
        expect(cncCut3DWorkFrame(grid)).toBeNull();
        registerCncCut3DWorkFrame(grid, device, placement);
        const axes = cncCut3DWorkFrame(grid);
        // Independent stock-frame oracle: work zero is the negative stock
        // centre, reflected only by the configured work-axis directions.
        // Both grid and zero translate by placement, so it cancels here.
        expect(axes?.originMm.x).toBeCloseTo(-(stockOrigin.x + stock.widthMm / 2) * xSign, 10);
        expect(axes?.originMm.y).toBeCloseTo(-(stockOrigin.y + stock.heightMm / 2) * ySign, 10);
        expect(axes?.originMm.z).toBe(0);
        expect(axes?.xDirection).toBe(xSign);
        expect(axes?.yDirection).toBe(ySign);
      }
    });
  }
});
