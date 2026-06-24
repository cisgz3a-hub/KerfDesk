import { describe, expect, it } from 'vitest';
import { REGISTRATION_LAYER_COLOR } from '../scene';
import { createRegistrationBox, REGISTRATION_BOX_OBJECT_ID } from './registration-box';

describe('createRegistrationBox', () => {
  it('creates a movable rectangle shape bound to the reserved registration color', () => {
    const box = createRegistrationBox({ widthMm: 80, heightMm: 40 });
    expect(box.kind).toBe('shape');
    expect(box.spec).toEqual({ kind: 'rect', widthMm: 80, heightMm: 40, cornerRadiusMm: 0 });
    expect(box.color).toBe(REGISTRATION_LAYER_COLOR);
    // Not locked — the operator can drag it onto the material and delete it.
    expect(box.locked).toBeUndefined();
    expect(box.id).toBe(REGISTRATION_BOX_OBJECT_ID);
    expect(box.bounds).toEqual({ minX: 0, minY: 0, maxX: 80, maxY: 40 });
  });

  it('materializes a single closed outline polyline', () => {
    const box = createRegistrationBox({ widthMm: 80, heightMm: 40 });
    expect(box.paths).toHaveLength(1);
    const path = box.paths[0];
    expect(path?.color).toBe(REGISTRATION_LAYER_COLOR);
    expect(path?.polylines).toHaveLength(1);
    expect(path?.polylines[0]?.closed).toBe(true);
    // sharp-corner rectangle: four corners plus the repeated first point.
    expect(path?.polylines[0]?.points).toHaveLength(5);
  });

  it('places the box at the requested origin', () => {
    const box = createRegistrationBox({ widthMm: 10, heightMm: 10, x: 15, y: 25 });
    expect(box.transform.x).toBe(15);
    expect(box.transform.y).toBe(25);
  });

  it('honors a custom id', () => {
    const box = createRegistrationBox({ widthMm: 10, heightMm: 10, id: 'jig-2' });
    expect(box.id).toBe('jig-2');
  });

  it('clamps non-finite or non-positive sizes to a minimum', () => {
    expect(createRegistrationBox({ widthMm: Number.NaN, heightMm: 40 }).spec).toMatchObject({
      widthMm: 1,
    });
    expect(createRegistrationBox({ widthMm: -5, heightMm: 0 }).spec).toMatchObject({
      widthMm: 1,
      heightMm: 1,
    });
  });
});
