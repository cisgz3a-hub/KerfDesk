import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { buildStageFurniture } from './viewer3d-stage';

const EXTENTS = { widthMm: 80, heightMm: 40 };

describe('Cut 3D work-zero axes', () => {
  it.each([
    { originMm: { x: 0, y: 0, z: 0 }, xDirection: 1, yDirection: 1 },
    { originMm: { x: 12, y: -9, z: 0 }, xDirection: -1, yDirection: -1 },
  ] as const)('places and points axes in their mapped work frame: %o', (workAxes) => {
    const stage = buildStageFurniture(three, EXTENTS, 6, workAxes);
    try {
      const axes = stage.object.children.find((child) => child instanceof three.AxesHelper);
      expect(axes).toBeDefined();
      if (!(axes instanceof three.AxesHelper)) throw new Error('Missing work axes');
      stage.object.updateMatrixWorld(true);
      expect(axes.position.toArray()).toEqual(Object.values(workAxes.originMm));
      const vertices = axes.geometry.getAttribute('position');
      const length = 80 * 0.18;
      const tips = [1, 3, 5].map((index) =>
        new three.Vector3().fromBufferAttribute(vertices, index).applyMatrix4(axes.matrixWorld),
      );
      expect(tips[0]?.x).toBeCloseTo(workAxes.originMm.x + workAxes.xDirection * length);
      expect(tips[1]?.y).toBeCloseTo(workAxes.originMm.y + workAxes.yDirection * length);
      expect(tips[2]?.z).toBeCloseTo(length);
      for (const grid of stage.object.children.filter(
        (child) => child instanceof three.GridHelper,
      )) {
        expect(grid.position.toArray()).toEqual([0, 0, -6.2]);
      }
    } finally {
      stage.dispose();
    }
  });

  it('does not invent a stock-corner work zero when the frame is unavailable', () => {
    const stage = buildStageFurniture(three, EXTENTS, 6, null);
    expect(stage.object.children.some((child) => child instanceof three.AxesHelper)).toBe(false);
    expect(stage.object.children.filter((child) => child instanceof three.GridHelper)).toHaveLength(
      2,
    );
    stage.dispose();
  });

  it('retains the existing stock-corner furniture for other surface viewers', () => {
    const stage = buildStageFurniture(three, EXTENTS, 6);
    const axes = stage.object.children.find((child) => child instanceof three.AxesHelper);
    expect(axes?.position.toArray()).toEqual([-40, -20, 0]);
    stage.dispose();
  });
});
