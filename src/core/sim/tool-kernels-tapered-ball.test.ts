import { describe, expect, it } from 'vitest';
import { taperedBallEnvelope, taperedBallHeightMm } from '../cnc-tapered-ball';
import { buildToolpath, type Job } from '../job';
import type { CncTool } from '../scene';
import { probeRemovalGrid } from './removal-grid-probe';
import { computeRemovalGrid } from './stamp-toolpath';
import { cuttingSurfaceDz, kernelForTool } from './tool-kernels';

// A tapered ball nose is a ball tip tangent to a straight flank (ADR-368). The
// simulator, relief dilation and removal stamping all read that one law.
const TBN: CncTool = {
  id: 'tbn',
  name: 'Tapered ball nose',
  kind: 'tapered-ball-nose',
  diameterMm: 6.25,
  tipAngleDeg: 10.8,
  tipDiameterMm: 1.5875,
};
const RADIUS_MM = TBN.diameterMm / 2;

function law(radiusMm: number): number {
  const envelope = taperedBallEnvelope(TBN);
  if (envelope === null) throw new Error('expected a modeled envelope');
  return taperedBallHeightMm(envelope, radiusMm);
}

describe('tapered ball-nose kernels', () => {
  it('cuts with the ball near the axis and the flank beyond the tangent point', () => {
    for (const radiusMm of [0, 0.3, 0.7, 0.9, 2, RADIUS_MM]) {
      expect(cuttingSurfaceDz(TBN, radiusMm, RADIUS_MM)).toBeCloseTo(law(radiusMm), 12);
    }
    // At 0.3 mm the 0.794 mm tip ball has risen only about 0.06 mm; a pointed
    // cone of the same 10.8 degree taper would already be 3.2 mm up its flank.
    expect(cuttingSurfaceDz(TBN, 0.3, RADIUS_MM)).toBeCloseTo(
      0.79375 - Math.sqrt(0.79375 ** 2 - 0.09),
      12,
    );
  });

  it('builds every kernel offset from the same law', () => {
    const kernel = kernelForTool(TBN, 0.1);
    expect(kernel.radiusMm).toBe(RADIUS_MM);
    for (const offset of kernel.offsets) {
      expect(offset.dz).toBeCloseTo(law(Math.hypot(offset.dx, offset.dy) * 0.1), 12);
    }
  });

  it('falls back to a flat land when the ball or taper is missing', () => {
    const { tipDiameterMm: _tip, ...noTip } = TBN;
    const { tipAngleDeg: _angle, ...noAngle } = TBN;
    for (const tool of [noTip, noAngle]) {
      expect(cuttingSurfaceDz(tool, 1, RADIUS_MM)).toBe(0);
      expect(kernelForTool(tool, 0.1).offsets.every((offset) => offset.dz === 0)).toBe(true);
    }
  });

  it('stamps a groove whose cross-section follows the ball and then the flank', () => {
    const depthMm = -2;
    // The groove runs along a column of cell centers, so each probed cell sits
    // an exact multiple of the cell size from the cutter axis.
    const axisX = 10.05;
    const job: Job = {
      groups: [
        {
          kind: 'cnc',
          layerId: 'tbn-layer',
          color: '#ff0000',
          cutType: 'engrave',
          toolId: TBN.id,
          toolDiameterMm: TBN.diameterMm,
          feedMmPerMin: 1000,
          plungeMmPerMin: 300,
          spindleRpm: 12000,
          spindleSpinupSec: 3,
          safeZMm: 3.81,
          passes: [
            {
              kind: 'contour',
              zMm: depthMm,
              closed: false,
              polyline: [
                { x: axisX, y: 4 },
                { x: axisX, y: 16 },
              ],
            },
          ],
        },
      ],
    };
    const result = computeRemovalGrid(
      buildToolpath(job, { startPoint: { x: 0, y: 0 } }),
      { originX: 0, originY: 0, widthMm: 20, heightMm: 20, mmPerCell: 0.1 },
      kernelForTool(TBN, 0.1),
    );
    if (result.kind !== 'ok') throw new Error(result.reason);

    for (const offsetMm of [0, 0.3, 0.7, 0.9, 1]) {
      const reading = probeRemovalGrid(result.grid, { x: axisX + offsetMm, y: 10 });
      if (reading.kind !== 'inside') throw new Error('probe landed off the grid');
      expect(reading.depthMm, `${offsetMm} mm from the axis`).toBeCloseTo(
        Math.min(0, depthMm + law(offsetMm)),
        2,
      );
    }
  });
});
