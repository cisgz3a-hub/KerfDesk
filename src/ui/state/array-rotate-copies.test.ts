// Circular array with "rotate copies": each copy must SPIN in place on its ring
// point. applyTransform rotates about the object's local origin, so adding the
// placement's rotationDeg without compensating x/y swung every copy off the
// ring (the same pivot bug as the workspace rotate handle). These cases assert
// the copy's transformed centre still lands on the ring.

import { describe, expect, it } from 'vitest';
import {
  arrayPlacements,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type ArrayPlacement,
  type SceneObject,
} from '../../core/scene';
import { placedObject } from './array-actions';

const CENTER = { x: 100, y: 100 };
const RADIUS = 40;

function squareAt(x: number, y: number): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'src',
    source: 'src.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    paths: [],
  };
}

function centreOf(object: SceneObject): { readonly x: number; readonly y: number } {
  const b = transformedBBox(object);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function circularPlacements(rotateCopies: boolean): ReadonlyArray<ArrayPlacement> {
  const source = squareAt(0, 0);
  return arrayPlacements(source.bounds, {
    kind: 'circular',
    count: 6,
    centerX: CENTER.x,
    centerY: CENTER.y,
    radius: RADIUS,
    startAngleDeg: 0,
    rotateCopies,
  });
}

describe('circular array with rotated copies', () => {
  it('keeps every rotated copy centred on the ring', () => {
    const source = squareAt(0, 0);
    const copies = circularPlacements(true).map((p) => placedObject(source, p));
    expect(copies).toHaveLength(6);
    for (const copy of copies) {
      const c = centreOf(copy);
      const distance = Math.hypot(c.x - CENTER.x, c.y - CENTER.y);
      expect(distance).toBeCloseTo(RADIUS, 6);
    }
  });

  it('still rotates each copy to face around the ring', () => {
    const source = squareAt(0, 0);
    const copies = circularPlacements(true).map((p) => placedObject(source, p));
    // First copy sits at angle 0 -> rotationDeg 90 (tangent-facing).
    expect(copies[0]?.transform.rotationDeg).toBeCloseTo(90, 6);
    // Six copies evenly spaced -> 60 degrees apart.
    expect(copies[1]?.transform.rotationDeg).toBeCloseTo(150, 6);
  });

  it('leaves un-rotated copies on the ring too (unchanged behaviour)', () => {
    const source = squareAt(0, 0);
    const copies = circularPlacements(false).map((p) => placedObject(source, p));
    for (const copy of copies) {
      const c = centreOf(copy);
      expect(Math.hypot(c.x - CENTER.x, c.y - CENTER.y)).toBeCloseTo(RADIUS, 6);
      expect(copy.transform.rotationDeg).toBe(0);
    }
  });
});
