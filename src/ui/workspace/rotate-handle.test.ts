import { describe, expect, it } from 'vitest';
import { applyTransform, IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import {
  hitRotateHandle,
  ROTATE_HANDLE_OFFSET_MM,
  rotateObjectByDrag,
  rotateHandlePosition,
} from './rotate-handle';

function obj(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
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
});
