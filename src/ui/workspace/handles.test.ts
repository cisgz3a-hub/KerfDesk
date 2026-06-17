import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import { handlesFor, hitHandle, scaleObjectByHandleDrag, selectionFrameFor } from './handles';

function obj(args: {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  tx?: number;
  ty?: number;
  sx?: number;
  sy?: number;
  rot?: number;
}): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: args.bounds,
    transform: {
      ...IDENTITY_TRANSFORM,
      x: args.tx ?? 0,
      y: args.ty ?? 0,
      scaleX: args.sx ?? 1,
      scaleY: args.sy ?? 1,
      rotationDeg: args.rot ?? 0,
    },
    paths: [],
  };
}

describe('handlesFor', () => {
  it('returns 4 corners + 4 edge midpoints of the transformed object', () => {
    const o = obj({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 20 } });
    const handles = handlesFor(o);
    expect(handles).toHaveLength(8);
    const byKind = Object.fromEntries(handles.map((h) => [h.kind, h.position]));
    expect(byKind['nw']).toEqual({ x: 0, y: 0 });
    expect(byKind['ne']).toEqual({ x: 10, y: 0 });
    expect(byKind['sw']).toEqual({ x: 0, y: 20 });
    expect(byKind['se']).toEqual({ x: 10, y: 20 });
    expect(byKind['n']).toEqual({ x: 5, y: 0 });
    expect(byKind['s']).toEqual({ x: 5, y: 20 });
    expect(byKind['e']).toEqual({ x: 10, y: 10 });
    expect(byKind['w']).toEqual({ x: 0, y: 10 });
  });

  it('reflects the object transform in the handle positions', () => {
    const o = obj({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, tx: 100, ty: 50 });
    const se = handlesFor(o).find((h) => h.kind === 'se');
    expect(se?.position).toEqual({ x: 110, y: 60 });
  });
});

describe('selectionFrameFor', () => {
  it('returns the transformed local bounds corners in draw order', () => {
    const o = obj({
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      tx: 20,
      ty: 30,
      rot: 90,
    });

    const frame = selectionFrameFor(o);

    expect(frame[0]?.x).toBeCloseTo(20);
    expect(frame[0]?.y).toBeCloseTo(30);
    expect(frame[1]?.x).toBeCloseTo(20);
    expect(frame[1]?.y).toBeCloseTo(40);
    expect(frame[2]?.x).toBeCloseTo(10);
    expect(frame[2]?.y).toBeCloseTo(40);
    expect(frame[3]?.x).toBeCloseTo(10);
    expect(frame[3]?.y).toBeCloseTo(30);
  });
});

describe('scaleObjectByHandleDrag — edge + center-out scaling', () => {
  it('east-edge drag only scales X, not Y', () => {
    const o = obj({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    const next = scaleObjectByHandleDrag({
      object: o,
      handle: 'e',
      dragTo: { x: 20, y: 100 }, // huge Y delta — should be ignored
      lockAspect: false,
    });
    expect(next.scaleX).toBeCloseTo(2);
    expect(next.scaleY).toBeCloseTo(1);
  });

  it('west-edge drag still scales when the selected anchor shares the west edge', () => {
    const o = obj({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    const beforeAnchor = handlePosition(o, 'e');

    const next = scaleObjectByHandleDrag({
      object: o,
      handle: 'w',
      dragTo: { x: -5, y: 100 },
      lockAspect: false,
      anchor: 'nw',
    });
    const after = { ...o, transform: next };
    const afterAnchor = handlePosition(after, 'e');

    expect(next.scaleX).toBeCloseTo(1.5);
    expect(next.scaleY).toBeCloseTo(1);
    expect(afterAnchor.x).toBeCloseTo(beforeAnchor.x, 6);
    expect(afterAnchor.y).toBeCloseTo(beforeAnchor.y, 6);
  });

  it('north-edge drag still scales when the selected anchor shares the north edge', () => {
    const o = obj({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    const beforeAnchor = handlePosition(o, 's');

    const next = scaleObjectByHandleDrag({
      object: o,
      handle: 'n',
      dragTo: { x: 100, y: -5 },
      lockAspect: false,
      anchor: 'nw',
    });
    const after = { ...o, transform: next };
    const afterAnchor = handlePosition(after, 's');

    expect(next.scaleX).toBeCloseTo(1);
    expect(next.scaleY).toBeCloseTo(1.5);
    expect(afterAnchor.x).toBeCloseTo(beforeAnchor.x, 6);
    expect(afterAnchor.y).toBeCloseTo(beforeAnchor.y, 6);
  });

  it('alt-drag (fromCenter) anchors at bbox center, doubles both halves', () => {
    const o = obj({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    // Drag SE corner to (10, 10) → original SE was already at (10,10), so
    // factor=1. Move it to (15, 15) instead, from center (5,5) → factor=2.
    const next = scaleObjectByHandleDrag({
      object: o,
      handle: 'se',
      dragTo: { x: 15, y: 15 },
      lockAspect: false,
      fromCenter: true,
    });
    expect(next.scaleX).toBeCloseTo(2);
    expect(next.scaleY).toBeCloseTo(2);
  });
});

describe('hitHandle', () => {
  it('picks the handle the cursor is on top of', () => {
    const o = obj({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    // pxToMm = 0.5 means 8 px handle = 4 mm wide → halfMm = 2
    expect(hitHandle(o, { x: 0.5, y: 0.5 }, 0.5)).toBe('nw');
    expect(hitHandle(o, { x: 10, y: 0 }, 0.5)).toBe('ne');
    expect(hitHandle(o, { x: 5, y: 5 }, 0.5)).toBeNull();
  });
});

describe('scaleObjectByHandleDrag', () => {
  it('SE drag: doubling the bbox doubles scaleX/scaleY and pins NW', () => {
    const o = obj({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    const next = scaleObjectByHandleDrag({
      object: o,
      handle: 'se',
      dragTo: { x: 20, y: 20 },
      lockAspect: false,
    });
    expect(next.scaleX).toBeCloseTo(2);
    expect(next.scaleY).toBeCloseTo(2);
    expect(next.x).toBeCloseTo(0); // NW anchor unchanged
    expect(next.y).toBeCloseTo(0);
  });

  it('NW drag: shrinking from top-left keeps SE corner pinned', () => {
    const o = obj({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    // Old NW = (0,0); drag to (5,5) → bbox becomes [(5,5), (10,10)] → 5×5
    const next = scaleObjectByHandleDrag({
      object: o,
      handle: 'nw',
      dragTo: { x: 5, y: 5 },
      lockAspect: false,
    });
    expect(next.scaleX).toBeCloseTo(0.5);
    expect(next.scaleY).toBeCloseTo(0.5);
    // SE corner stays at (10,10): post-transform applyTransform({maxX,maxY}, next) ≈ (10,10).
    expect(next.scaleX * 10 + next.x).toBeCloseTo(10);
    expect(next.scaleY * 10 + next.y).toBeCloseTo(10);
  });

  it('lockAspect: takes the smaller factor on both axes', () => {
    const o = obj({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    // Drag SE to (15, 30): unlocked → sx=1.5, sy=3; locked → both 1.5.
    const next = scaleObjectByHandleDrag({
      object: o,
      handle: 'se',
      dragTo: { x: 15, y: 30 },
      lockAspect: true,
    });
    expect(next.scaleX).toBeCloseTo(1.5);
    expect(next.scaleY).toBeCloseTo(1.5);
  });

  it('protects against full collapse (factor clamped above zero)', () => {
    const o = obj({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    const next = scaleObjectByHandleDrag({
      object: o,
      handle: 'se',
      dragTo: { x: 0, y: 0 }, // would collapse to a point
      lockAspect: false,
    });
    expect(Math.abs(next.scaleX)).toBeGreaterThan(0);
    expect(Math.abs(next.scaleY)).toBeGreaterThan(0);
  });

  it('keeps the opposite anchor fixed when resizing a rotated object', () => {
    const o = obj({
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
      tx: 80,
      ty: 60,
      rot: 30,
    });
    const beforeAnchor = handlePosition(o, 'nw');
    const beforeDragHandle = handlePosition(o, 'se');

    const next = scaleObjectByHandleDrag({
      object: o,
      handle: 'se',
      dragTo: { x: beforeDragHandle.x + 25, y: beforeDragHandle.y + 15 },
      lockAspect: false,
    });
    const after = { ...o, transform: next };
    const afterAnchor = handlePosition(after, 'nw');

    expect(afterAnchor.x).toBeCloseTo(beforeAnchor.x, 5);
    expect(afterAnchor.y).toBeCloseTo(beforeAnchor.y, 5);
  });

  it('keeps the selected canvas anchor fixed when resizing from a different handle', () => {
    const o = obj({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    const beforeAnchor = handlePosition(o, 'w');

    const next = scaleObjectByHandleDrag({
      object: o,
      handle: 'se',
      dragTo: { x: 20, y: 30 },
      lockAspect: false,
      anchor: 'w',
    });
    const after = { ...o, transform: next };
    const afterAnchor = handlePosition(after, 'w');

    expect(afterAnchor.x).toBeCloseTo(beforeAnchor.x, 6);
    expect(afterAnchor.y).toBeCloseTo(beforeAnchor.y, 6);
    expect(next.scaleX).toBeCloseTo(2);
    expect(next.scaleY).toBeCloseTo(5);
  });
});

function handlePosition(
  object: SceneObject,
  kind: 'nw' | 'e' | 's' | 'se' | 'w',
): { readonly x: number; readonly y: number } {
  const handle = handlesFor(object).find((item) => item.kind === kind);
  if (handle === undefined) throw new Error(`missing ${kind} handle`);
  return handle.position;
}
