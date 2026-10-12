import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject, type Transform, type Vec2 } from './scene-object';
import {
  buildSelectionMirrorAcrossLineEdit,
  buildSelectionRotateByEdit,
  buildSelectionRotateScaleEdit,
} from './selection-rotate';
import { applyTransform } from './transform';

const CORNERS: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 3, y: 7 },
];

// A deliberately awkward transform: rotated, mirrored and non-uniformly scaled.
const AWKWARD: Transform = {
  x: 40,
  y: -12,
  scaleX: 1.7,
  scaleY: 0.6,
  rotationDeg: 33,
  mirrorX: true,
  mirrorY: false,
};

describe('selection similarity edits', () => {
  it('rotates and scales about a pivot exactly, for any object transform', () => {
    const object = rect('a', AWKWARD);
    const pivot = { x: 5, y: 9 };
    const result = buildSelectionRotateScaleEdit([object], 27, 1.5, pivot);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const after = result.transforms[0]?.transform as Transform;
    for (const local of CORNERS) {
      const before = applyTransform(local, AWKWARD);
      const expected = similarity(before, pivot, 27, 1.5);
      expectClose(applyTransform(local, after), expected);
    }
  });

  it('mirrors across an arbitrary line exactly and twice returns to the start', () => {
    const object = rect('a', AWKWARD);
    const a = { x: 1, y: 2 };
    const b = { x: 11, y: 9 };
    const once = buildSelectionMirrorAcrossLineEdit([object], a, b);
    if (once.kind !== 'ok') throw new Error('expected ok');
    const mirrored = once.transforms[0]?.transform as Transform;
    for (const local of CORNERS) {
      expectClose(applyTransform(local, mirrored), reflect(applyTransform(local, AWKWARD), a, b));
    }
    const twice = buildSelectionMirrorAcrossLineEdit([{ ...object, transform: mirrored }], a, b);
    if (twice.kind !== 'ok') throw new Error('expected ok');
    for (const local of CORNERS) {
      expectClose(
        applyTransform(local, twice.transforms[0]?.transform as Transform),
        applyTransform(local, AWKWARD),
      );
    }
  });

  it('rotates about the selection centre by default and rejects bad input', () => {
    const result = buildSelectionRotateByEdit([rect('a', IDENTITY_TRANSFORM)], 90);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expectClose(result.transforms[0]?.transform as Vec2, { x: 15, y: -5 });
    expect(buildSelectionRotateScaleEdit([rect('a', IDENTITY_TRANSFORM)], 0, 0).kind).toBe('error');
    expect(
      buildSelectionMirrorAcrossLineEdit(
        [rect('a', IDENTITY_TRANSFORM)],
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ).kind,
    ).toBe('error');
  });
});

function similarity(p: Vec2, c: Vec2, deg: number, k: number): Vec2 {
  const rad = (deg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return {
    x: c.x + k * (dx * Math.cos(rad) - dy * Math.sin(rad)),
    y: c.y + k * (dx * Math.sin(rad) + dy * Math.cos(rad)),
  };
}

function reflect(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const length = Math.hypot(ux, uy);
  const nx = ux / length;
  const ny = uy / length;
  const dx = p.x - a.x;
  const dy = p.y - a.y;
  const along = dx * nx + dy * ny;
  return { x: a.x + 2 * along * nx - dx, y: a.y + 2 * along * ny - dy };
}

function expectClose(actual: Vec2, expected: Vec2): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

function rect(id: string, transform: Transform): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform,
    paths: [],
  };
}
