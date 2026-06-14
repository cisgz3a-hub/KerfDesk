import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject, type Transform } from './scene-object';
import { applyTransform, flipTransformAboutCenter } from './transform';

describe('applyTransform', () => {
  it('returns the input point unchanged under the identity transform', () => {
    expect(applyTransform({ x: 3, y: 4 }, IDENTITY_TRANSFORM)).toEqual({
      x: 3,
      y: 4,
    });
  });

  it('translates by (t.x, t.y)', () => {
    const t: Transform = { ...IDENTITY_TRANSFORM, x: 10, y: 20 };
    expect(applyTransform({ x: 1, y: 2 }, t)).toEqual({ x: 11, y: 22 });
  });

  it('scales then translates', () => {
    const t: Transform = { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 3, x: 5, y: 0 };
    expect(applyTransform({ x: 1, y: 1 }, t)).toEqual({ x: 7, y: 3 });
  });

  it('mirrors around the local origin', () => {
    const t: Transform = { ...IDENTITY_TRANSFORM, mirrorX: true };
    expect(applyTransform({ x: 5, y: 7 }, t)).toEqual({ x: -5, y: 7 });
  });

  it('rotates 90° counter-clockwise around the local origin', () => {
    const t: Transform = { ...IDENTITY_TRANSFORM, rotationDeg: 90 };
    const got = applyTransform({ x: 1, y: 0 }, t);
    // cos(90°)≈0, sin(90°)≈1 → (1,0) → (0,1) with floating-point fuzz
    expect(got.x).toBeCloseTo(0);
    expect(got.y).toBeCloseTo(1);
  });

  it('applies scale then mirror then rotate then translate in that order', () => {
    const t: Transform = {
      scaleX: 2,
      scaleY: 2,
      mirrorX: true,
      mirrorY: false,
      rotationDeg: 180,
      x: 100,
      y: 50,
    };
    // (1,1) → scale (2,2) → mirror (-2,2) → rotate 180 (2,-2) → translate (102, 48)
    const got = applyTransform({ x: 1, y: 1 }, t);
    expect(got.x).toBeCloseTo(102);
    expect(got.y).toBeCloseTo(48);
  });
});

describe('flipTransformAboutCenter', () => {
  it('keeps the transformed center fixed when flipping horizontally', () => {
    const object = objectWithTransform({
      x: 40,
      y: 25,
      scaleX: 1.5,
      scaleY: 0.75,
      rotationDeg: 90,
      mirrorX: false,
      mirrorY: false,
    });
    const before = transformedCenter(object);

    const next = flipTransformAboutCenter(object, 'horizontal');
    const after = transformedCenter({ ...object, transform: next });

    expect(next.mirrorX).toBe(true);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('keeps the transformed center fixed when flipping vertically', () => {
    const object = objectWithTransform({
      x: -12,
      y: 80,
      scaleX: 0.8,
      scaleY: 1.25,
      rotationDeg: 30,
      mirrorX: false,
      mirrorY: false,
    });
    const before = transformedCenter(object);

    const next = flipTransformAboutCenter(object, 'vertical');
    const after = transformedCenter({ ...object, transform: next });

    expect(next.mirrorY).toBe(true);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

function objectWithTransform(transform: Transform): SceneObject {
  return {
    kind: 'shape',
    id: 'shape-1',
    spec: { kind: 'rect', widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform,
    paths: [],
  };
}

function transformedCenter(object: SceneObject): { readonly x: number; readonly y: number } {
  return applyTransform(
    {
      x: (object.bounds.minX + object.bounds.maxX) / 2,
      y: (object.bounds.minY + object.bounds.maxY) / 2,
    },
    object.transform,
  );
}
