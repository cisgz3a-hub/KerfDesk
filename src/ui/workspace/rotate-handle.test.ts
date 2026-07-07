import { describe, expect, it } from 'vitest';
import { applyTransform, IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import {
  hitRotateHandle,
  objectRotateAnchor,
  pointerAngleDeg,
  ROTATE_HANDLE_OFFSET_MM,
  rotateObjectRelative,
  rotateSelectionByDrag,
  rotateObjectByDrag,
  rotateHandlePosition,
} from './rotate-handle';

function obj(id = 'O1', x = 0, y = 0): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: 'a.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    paths: [],
  };
}

describe('rotate-handle', () => {
  it('sits ROTATE_HANDLE_OFFSET_MM above the bbox top-mid', () => {
    const pos = rotateHandlePosition(obj());
    expect(pos.x).toBe(5);
    expect(pos.y).toBe(-ROTATE_HANDLE_OFFSET_MM);
  });

  it('hitRotateHandle is true when within px-tolerance, false outside', () => {
    expect(hitRotateHandle(obj(), { x: 5, y: -ROTATE_HANDLE_OFFSET_MM }, 1)).toBe(true);
    expect(hitRotateHandle(obj(), { x: 100, y: 100 }, 1)).toBe(false);
  });

  it('rotateObjectByDrag with dragTo directly above center yields ~0°', () => {
    const t = rotateObjectByDrag({
      object: obj(),
      dragTo: { x: 5, y: -50 },
      snap: false,
    });
    // Allow small float noise.
    expect(Math.abs(t.rotationDeg) < 0.001).toBe(true);
  });

  it('snap quantizes to 15° increments', () => {
    // dragTo at +20° from up direction (somewhere to the right of center)
    // → snapped to 15° or 30°.
    const t = rotateObjectByDrag({
      object: obj(),
      dragTo: { x: 8, y: -50 },
      snap: true,
    });
    expect(Number.isInteger(t.rotationDeg / 15)).toBe(true);
  });
  it('keeps the selected canvas anchor fixed while rotating', () => {
    const object = obj();
    const beforeAnchor = applyTransform({ x: 0, y: 0 }, object.transform);

    const t = rotateObjectByDrag({
      object,
      dragTo: { x: 50, y: 0 },
      snap: false,
      anchor: 'nw',
    });
    const afterAnchor = applyTransform({ x: 0, y: 0 }, t);

    expect(t.rotationDeg).toBeCloseTo(90);
    expect(afterAnchor.x).toBeCloseTo(beforeAnchor.x, 6);
    expect(afterAnchor.y).toBeCloseTo(beforeAnchor.y, 6);
  });

  // Audit C2: the relative model must not move a pre-rotated object when the
  // pointer is still at the grab angle (no jump on grab).
  it('rotateObjectRelative leaves a pre-rotated object unmoved at the grab angle', () => {
    const startTransform = { ...IDENTITY_TRANSFORM, rotationDeg: 30 };
    const anchor = { x: 5, y: 5 };
    const grab = { x: 5, y: -20 };
    const t = rotateObjectRelative({
      startTransform,
      anchor,
      startPointerAngleDeg: pointerAngleDeg(anchor, grab),
      dragTo: grab,
      snap: false,
    });
    expect(t.rotationDeg).toBeCloseTo(30, 6);
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.y).toBeCloseTo(0, 6);
  });

  it('rotateObjectRelative adds the pointer-angle delta to the start rotation', () => {
    const startTransform = { ...IDENTITY_TRANSFORM, rotationDeg: 30 };
    const anchor = { x: 0, y: 0 };
    // grab pointing +x (0°); drag to +y is +90°, so result = 30 + 90 = 120.
    const t = rotateObjectRelative({
      startTransform,
      anchor,
      startPointerAngleDeg: 0,
      dragTo: { x: 0, y: 10 },
      snap: false,
    });
    expect(t.rotationDeg).toBeCloseTo(120, 6);
  });

  it('rotateObjectRelative snaps the resulting absolute angle to 15°', () => {
    const startTransform = { ...IDENTITY_TRANSFORM, rotationDeg: 7 };
    const anchor = { x: 0, y: 0 };
    const t = rotateObjectRelative({
      startTransform,
      anchor,
      startPointerAngleDeg: 0,
      dragTo: { x: 10, y: 1 }, // ~+5.7°, so 7 + 5.7 ≈ 12.7 → snaps to 15
      snap: true,
    });
    expect(Number.isInteger(t.rotationDeg / 15)).toBe(true);
  });

  it('objectRotateAnchor returns the bbox center for the default anchor', () => {
    expect(objectRotateAnchor(obj())).toEqual({ x: 5, y: 5 });
  });

  it('rotates every selected start transform around the shared selection center', () => {
    const updates = rotateSelectionByDrag({
      startTransforms: [
        { id: 'A', transform: obj('A', 0, 0).transform },
        { id: 'B', transform: obj('B', 30, 0).transform },
      ],
      anchor: { x: 20, y: 5 },
      startPointerAngleDeg: -90,
      dragTo: { x: 70, y: 5 },
      snap: false,
    });

    expect(updates).toHaveLength(2);
    expect(updates[0]?.id).toBe('A');
    expect(updates[0]?.transform.x).toBeCloseTo(25, 6);
    expect(updates[0]?.transform.y).toBeCloseTo(-15, 6);
    expect(updates[0]?.transform.rotationDeg).toBeCloseTo(90, 6);
    expect(updates[1]?.id).toBe('B');
    expect(updates[1]?.transform.x).toBeCloseTo(25, 6);
    expect(updates[1]?.transform.y).toBeCloseTo(15, 6);
    expect(updates[1]?.transform.rotationDeg).toBeCloseTo(90, 6);
  });
});
