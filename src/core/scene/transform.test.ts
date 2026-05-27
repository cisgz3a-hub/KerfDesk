import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type Transform } from './scene-object';
import { applyTransform } from './transform';

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
