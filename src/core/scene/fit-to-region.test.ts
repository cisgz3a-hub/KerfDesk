import { describe, expect, it } from 'vitest';
import { fitObjectToRegion } from './fit-to-region';
import { transformedBBox } from './hit-test';
import { IDENTITY_TRANSFORM, type Bounds, type SceneObject, type Transform } from './scene-object';
import { applyTransform } from './transform';

function obj(bounds: Bounds, transform: Transform = IDENTITY_TRANSFORM): SceneObject {
  return { kind: 'imported-svg', id: 'O1', source: 'a.svg', bounds, transform, paths: [] };
}

const BED: Bounds = { minX: 0, minY: 0, maxX: 400, maxY: 400 };

describe('fitObjectToRegion', () => {
  it('grows a small design UP to fill the region when grow=true', () => {
    // 50×30 in a 400×400 region: limit is width, scale = 0.9 * 400/50 = 7.2
    const fitted = fitObjectToRegion(obj({ minX: 0, minY: 0, maxX: 50, maxY: 30 }), BED, {
      marginFraction: 0.9,
      grow: true,
    });
    expect(fitted.transform.scaleX).toBeCloseTo(7.2);
    expect(fitted.transform.scaleY).toBeCloseTo(7.2);
  });

  it('leaves a small design at scale 1 when grow=false (fit-to-bed parity)', () => {
    const fitted = fitObjectToRegion(obj({ minX: 0, minY: 0, maxX: 50, maxY: 30 }), BED, {
      marginFraction: 0.9,
      grow: false,
    });
    expect(fitted.transform.scaleX).toBe(1);
    expect(fitted.transform.scaleY).toBe(1);
  });

  it('scales a big design down regardless of grow', () => {
    for (const grow of [true, false]) {
      // 1000×1000 in 400×400 → 0.9 * 400/1000 = 0.36
      const fitted = fitObjectToRegion(obj({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }), BED, {
        marginFraction: 0.9,
        grow,
      });
      expect(fitted.transform.scaleX).toBeCloseTo(0.36);
    }
  });

  it('chooses the limiting dimension', () => {
    // 200×800 in 400×400 → limit is height: 0.9 * 400/800 = 0.45
    const fitted = fitObjectToRegion(obj({ minX: 0, minY: 0, maxX: 200, maxY: 800 }), BED, {
      marginFraction: 0.9,
      grow: true,
    });
    expect(fitted.transform.scaleX).toBeCloseTo(0.45);
  });

  it('centers the design on a region that is NOT at the origin', () => {
    // Region (100,100)..(300,300): a placed board sits away from the bed corner.
    const region: Bounds = { minX: 100, minY: 100, maxX: 300, maxY: 300 };
    const fitted = fitObjectToRegion(obj({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }), region, {
      marginFraction: 0.9,
      grow: true,
    });
    const center = applyTransform({ x: 500, y: 500 }, fitted.transform);
    expect(center.x).toBeCloseTo(200);
    expect(center.y).toBeCloseTo(200);
  });

  it('centers a ROTATED design at the region center (rotation-safe)', () => {
    // A 100×100 design rotated 90° must still land centered — fitObjectToBed's
    // scale·center offset would miss this.
    const rotated: Transform = { ...IDENTITY_TRANSFORM, rotationDeg: 90 };
    const fitted = fitObjectToRegion(
      obj({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, rotated),
      BED,
      {
        marginFraction: 0.9,
        grow: true,
      },
    );
    const center = applyTransform({ x: 50, y: 50 }, fitted.transform);
    expect(center.x).toBeCloseTo(200);
    expect(center.y).toBeCloseTo(200);
  });

  it('fits a rotated non-square design fully inside the region (no off-material overflow)', () => {
    // 100×20 rotated 90° has a 20×100 footprint. On a 120×40 region the fit must
    // key on that footprint, not the intrinsic 100×20 — else it overflows the
    // board (and burns off the physical material). scale = 0.9·min(120/20, 40/100)
    // = 0.36 → footprint 7.2×36, centered.
    const rotated: Transform = { ...IDENTITY_TRANSFORM, rotationDeg: 90 };
    const region: Bounds = { minX: 0, minY: 0, maxX: 120, maxY: 40 };
    const fitted = fitObjectToRegion(
      obj({ minX: 0, minY: 0, maxX: 100, maxY: 20 }, rotated),
      region,
      {
        marginFraction: 0.9,
        grow: true,
      },
    );
    const bbox = transformedBBox(fitted);
    expect(bbox.minX).toBeGreaterThanOrEqual(region.minX);
    expect(bbox.maxX).toBeLessThanOrEqual(region.maxX);
    expect(bbox.minY).toBeGreaterThanOrEqual(region.minY);
    expect(bbox.maxY).toBeLessThanOrEqual(region.maxY);
    expect(bbox.maxX - bbox.minX).toBeCloseTo(7.2);
    expect(bbox.maxY - bbox.minY).toBeCloseTo(36);
  });

  it('returns the object unchanged for degenerate object bounds', () => {
    const o = obj({ minX: 10, minY: 10, maxX: 10, maxY: 40 });
    expect(fitObjectToRegion(o, BED, { marginFraction: 0.9, grow: true })).toBe(o);
  });

  it('returns the object unchanged for a degenerate region', () => {
    const o = obj({ minX: 0, minY: 0, maxX: 50, maxY: 50 });
    const flat: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 400 };
    expect(fitObjectToRegion(o, flat, { marginFraction: 0.9, grow: true })).toBe(o);
  });
});
