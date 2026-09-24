import { describe, expect, it } from 'vitest';
import { applyTransform } from './transform';
import { fitObjectToBed, measureBedFit, scaleObjectAboutCenter } from './fit-to-bed';
import { transformedBBox } from './hit-test';
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

  it('keeps a design exactly the bed size at its size, edge to edge', () => {
    const fitted = fitObjectToBed(obj({ minX: 0, minY: 0, maxX: 400, maxY: 400 }), 400, 400);
    expect(fitted.transform.scaleX).toBe(1);
    expect(fitted.transform.scaleY).toBe(1);
    expect(transformedBBox(fitted)).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 400 });
  });

  it('keeps a 390 mm design at its size (the old 90% cap shrank it to 360 mm)', () => {
    const fitted = fitObjectToBed(obj({ minX: 12, minY: 5, maxX: 402, maxY: 105 }), 400, 400);
    expect(fitted.transform.scaleX).toBe(1);
    const box = transformedBBox(fitted);
    expect(box.maxX - box.minX).toBe(390);
    expect((box.minX + box.maxX) / 2).toBe(200);
  });

  it('does not mistake float noise over the bed for an oversize design', () => {
    // One ulp over 400 mm, as a px or inch to mm conversion can leave it.
    const noisyWidth = 400.00000000000006;
    expect(noisyWidth).toBeGreaterThan(400);
    const fitted = fitObjectToBed(obj({ minX: 0, minY: 0, maxX: noisyWidth, maxY: 300 }), 400, 400);
    expect(fitted.transform.scaleX).toBe(1);
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

  it('fits a rotated design by its rotated footprint', () => {
    // 1000 x 100 turned 90 degrees is 100 wide and 1000 tall on the bed.
    const rotated = {
      ...obj({ minX: 0, minY: 0, maxX: 1000, maxY: 100 }),
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 90 },
    };
    const box = transformedBBox(fitObjectToBed(rotated, 400, 400));
    expect(box.maxY - box.minY).toBeCloseTo(360);
    expect(box.maxX - box.minX).toBeCloseTo(36);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(200);
  });

  it('returns the original object unchanged for zero/negative bounds', () => {
    const o = obj({ minX: 10, minY: 10, maxX: 10, maxY: 10 });
    expect(fitObjectToBed(o, 400, 400)).toBe(o);
  });
});

describe('measureBedFit', () => {
  it('reports the footprint and a scale of 1 for art that fits', () => {
    expect(measureBedFit(obj({ minX: 0, minY: 0, maxX: 400, maxY: 250 }), 400, 400)).toEqual({
      scale: 1,
      widthMm: 400,
      heightMm: 250,
      bedWidthMm: 400,
      bedHeightMm: 400,
    });
  });

  it('reports the uniform scale that brings over-bed art inside the bed', () => {
    const fit = measureBedFit(obj({ minX: 0, minY: 0, maxX: 300, maxY: 500 }), 400, 400);
    expect(fit.scale).toBeCloseTo(0.72);
    expect(fit).toMatchObject({ widthMm: 300, heightMm: 500 });
  });

  it('measures the scaled footprint, not the raw bounds', () => {
    const doubled = {
      ...obj({ minX: 0, minY: 0, maxX: 300, maxY: 100 }),
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 2 },
    };
    const fit = measureBedFit(doubled, 400, 400);
    expect(fit).toMatchObject({ widthMm: 600, heightMm: 200 });
    expect(fit.scale).toBeCloseTo(0.6);
  });
});

describe('scaleObjectAboutCenter', () => {
  it('keeps the bounds center where it was, offset included', () => {
    const staggered = {
      ...obj({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }),
      transform: { ...IDENTITY_TRANSFORM, x: -290, y: -290 },
    };
    const scaled = scaleObjectAboutCenter(staggered, 0.36);
    expect(scaled.transform.scaleX).toBeCloseTo(0.36);
    expect(applyTransform({ x: 500, y: 500 }, scaled.transform).x).toBeCloseTo(210);
    expect(applyTransform({ x: 500, y: 500 }, scaled.transform).y).toBeCloseTo(210);
  });

  it('returns the same object for a factor of 1', () => {
    const o = obj({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(scaleObjectAboutCenter(o, 1)).toBe(o);
  });
});

describe('fitObjectToBed center-only mode', () => {
  it('centers an over-bed object without reducing either scale axis', () => {
    const centered = fitObjectToBed(
      obj({ minX: 0, minY: 0, maxX: 100, maxY: 1000 }),
      400,
      400,
      'center-only',
    );

    expect(centered.transform.scaleX).toBe(1);
    expect(centered.transform.scaleY).toBe(1);
    expect(applyTransform({ x: 50, y: 500 }, centered.transform)).toEqual({ x: 200, y: 200 });
  });

  it('preserves nonuniform scale, rotation, and mirror while centering', () => {
    const source = {
      ...obj({ minX: 10, minY: 20, maxX: 110, maxY: 70 }),
      transform: {
        ...IDENTITY_TRANSFORM,
        x: 31,
        y: 47,
        scaleX: -2,
        scaleY: 0.5,
        rotationDeg: 25,
        mirrorX: true,
      },
    };
    const centered = fitObjectToBed(source, 400, 300, 'center-only');

    expect(centered.transform).toMatchObject({
      scaleX: -2,
      scaleY: 0.5,
      rotationDeg: 25,
      mirrorX: true,
    });
    expect(applyTransform({ x: 60, y: 45 }, centered.transform)).toMatchObject({ x: 200, y: 150 });
  });
});
