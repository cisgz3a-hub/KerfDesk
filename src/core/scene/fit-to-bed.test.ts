import { describe, expect, it } from 'vitest';
import { applyTransform } from './transform';
import { fitObjectToBed } from './fit-to-bed';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';

function obj(bounds: { minX: number; minY: number; maxX: number; maxY: number }): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds,
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
}

describe('fitObjectToBed', () => {
  it("leaves small designs at scale 1 (we don't grow them to fill)", () => {
    const fitted = fitObjectToBed(obj({ minX: 0, minY: 0, maxX: 50, maxY: 30 }), 400, 400);
    expect(fitted.transform.scaleX).toBe(1);
    expect(fitted.transform.scaleY).toBe(1);
  });

  it('scales a big design down with a 10% margin', () => {
    // Design is 1000×1000 on a 400×400 bed → uniform scale = 0.9 * 400/1000 = 0.36
    const fitted = fitObjectToBed(obj({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }), 400, 400);
    expect(fitted.transform.scaleX).toBeCloseTo(0.36);
    expect(fitted.transform.scaleY).toBeCloseTo(0.36);
  });

  it('chooses the limiting dimension when w and h differ', () => {
    // 200×800 on 400×400 → limit is height: scale = 0.9 * 400/800 = 0.45
    const fitted = fitObjectToBed(obj({ minX: 0, minY: 0, maxX: 200, maxY: 800 }), 400, 400);
    expect(fitted.transform.scaleX).toBeCloseTo(0.45);
  });

  it('centers the scaled bounds on the bed', () => {
    // 1000×1000 fitted on 400×400. Bounds center is (500, 500); after scale
    // 0.36 the bounds center sits at (180, 180); transform.x/y should pull
    // that to (200, 200) — the bed center.
    const fitted = fitObjectToBed(obj({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }), 400, 400);
    const center = applyTransform({ x: 500, y: 500 }, fitted.transform);
    expect(center.x).toBeCloseTo(200);
    expect(center.y).toBeCloseTo(200);
  });

  it('returns the original object unchanged for zero/negative bounds', () => {
    const o = obj({ minX: 10, minY: 10, maxX: 10, maxY: 10 });
    expect(fitObjectToBed(o, 400, 400)).toBe(o);
  });
});
