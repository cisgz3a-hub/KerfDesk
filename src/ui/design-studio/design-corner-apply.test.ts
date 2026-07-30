import { describe, expect, it } from 'vitest';
import type { Sketch, SketchPath, SketchRectangle } from '../../core/design';
import { applyCornerOp } from './design-corner-apply';
import { pickCorner } from './design-corner-pick';

const rect: SketchRectangle = {
  kind: 'rect',
  id: 'r',
  origin: { x: 0, y: 0 },
  widthMm: 100,
  heightMm: 60,
  cornerRadiusMm: 0,
};

const elbow: SketchPath = {
  kind: 'path',
  id: 'p',
  points: [
    { x: 200, y: 0 },
    { x: 260, y: 0 },
    { x: 260, y: 60 },
  ],
  closed: false,
};

describe('pickCorner', () => {
  it('names a specific vertex on a path', () => {
    const pick = pickCorner({ entities: [elbow] }, { x: 258, y: 1 }, 6);
    expect(pick?.kind).toBe('path-corner');
    if (pick?.kind !== 'path-corner') return;
    expect(pick.cornerIndex).toBe(1);
    expect(pick.entityId).toBe('p');
  });

  it('does not offer the ends of an open path', () => {
    expect(pickCorner({ entities: [elbow] }, { x: 200, y: 0 }, 6)).toBeNull();
    expect(pickCorner({ entities: [elbow] }, { x: 260, y: 60 }, 6)).toBeNull();
  });

  it('names the rectangle itself, not one of its corners', () => {
    const pick = pickCorner({ entities: [rect] }, { x: 1, y: 1 }, 6);
    expect(pick?.kind).toBe('rect');
    expect(pick?.entityId).toBe('r');
  });

  it('offers all four rectangle corners as pick points', () => {
    for (const at of [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 },
    ]) {
      expect(pickCorner({ entities: [rect] }, at, 2), JSON.stringify(at)).not.toBeNull();
    }
  });

  it('has no corner on a circle, arc, or line', () => {
    const round: Sketch = {
      entities: [
        { kind: 'circle', id: 'c', center: { x: 0, y: 0 }, radiusMm: 20 },
        { kind: 'line', id: 'l', start: { x: 50, y: 0 }, end: { x: 90, y: 0 } },
      ],
    };
    expect(pickCorner(round, { x: 20, y: 0 }, 6)).toBeNull();
    expect(pickCorner(round, { x: 50, y: 0 }, 6)).toBeNull();
  });

  it('returns null beyond the tolerance', () => {
    expect(pickCorner({ entities: [rect] }, { x: 40, y: 30 }, 6)).toBeNull();
  });

  it('prefers the topmost entity on a tie, matching selection', () => {
    const overlapping: Sketch = { entities: [rect, { ...rect, id: 'top' }] };
    expect(pickCorner(overlapping, { x: 0, y: 0 }, 4)?.entityId).toBe('top');
  });
});

describe('applyCornerOp — path corners', () => {
  const sketch: Sketch = { entities: [elbow] };
  const pick = pickCorner(sketch, { x: 260, y: 0 }, 4);

  it('fillets the picked corner', () => {
    if (pick === null) throw new Error('expected a pick');
    const next = applyCornerOp(sketch, pick, 'fillet', 15);
    expect(next).not.toBeNull();
    const path = next!.entities[0] as SketchPath;
    // The vertex is replaced by an arc, so the point count grows.
    expect(path.points.length).toBeGreaterThan(3);
  });

  it('chamfers the picked corner into exactly two points', () => {
    if (pick === null) throw new Error('expected a pick');
    const next = applyCornerOp(sketch, pick, 'chamfer', 15);
    const path = next!.entities[0] as SketchPath;
    expect(path.points).toHaveLength(4);
    expect(path.points[1]).toEqual({ x: 245, y: 0 });
    expect(path.points[2]).toEqual({ x: 260, y: 15 });
  });

  it('leaves the sketch untouched when the size will not fit', () => {
    if (pick === null) throw new Error('expected a pick');
    expect(applyCornerOp(sketch, pick, 'chamfer', 500)).toBeNull();
  });
});

describe('applyCornerOp — rectangles', () => {
  const sketch: Sketch = { entities: [rect] };
  const pick = pickCorner(sketch, { x: 0, y: 0 }, 4);

  it('fillets a rectangle parametrically, keeping it a rectangle', () => {
    if (pick === null) throw new Error('expected a pick');
    const next = applyCornerOp(sketch, pick, 'fillet', 12);
    const edited = next!.entities[0];
    expect(edited?.kind).toBe('rect');
    if (edited?.kind !== 'rect') return;
    expect(edited.cornerRadiusMm).toBe(12);
    // Position and size are untouched — only the radius changed.
    expect(edited.origin).toEqual({ x: 0, y: 0 });
    expect(edited.widthMm).toBe(100);
  });

  it('refuses a radius larger than half the shorter side', () => {
    if (pick === null) throw new Error('expected a pick');
    // The shorter side is 60, so the limit is 30.
    expect(applyCornerOp(sketch, pick, 'fillet', 31)).toBeNull();
    expect(applyCornerOp(sketch, pick, 'fillet', 30)).not.toBeNull();
  });

  // Chamfer has no parametric form on a rect, so the shape becomes an explicit
  // path — the honest result rather than pretending it is still a plain rectangle.
  it('converts to a closed path when chamfering, and chamfers all four corners', () => {
    if (pick === null) throw new Error('expected a pick');
    const next = applyCornerOp(sketch, pick, 'chamfer', 10);
    const edited = next!.entities[0];
    expect(edited?.kind).toBe('path');
    if (edited?.kind !== 'path') return;
    expect(edited.closed).toBe(true);
    // Four corners, each one vertex becoming two.
    expect(edited.points).toHaveLength(8);
    expect(edited.id).toBe('r');
  });

  it('refuses to chamfer an already-rounded rectangle', () => {
    const rounded: Sketch = { entities: [{ ...rect, cornerRadiusMm: 8 }] };
    const roundedPick = pickCorner(rounded, { x: 0, y: 0 }, 12);
    if (roundedPick === null) throw new Error('expected a pick');
    expect(applyCornerOp(rounded, roundedPick, 'chamfer', 5)).toBeNull();
  });
});

describe('applyCornerOp — missing input', () => {
  it('returns null for an entity that is no longer there', () => {
    expect(
      applyCornerOp(
        { entities: [] },
        { kind: 'rect', entityId: 'gone', atMm: { x: 0, y: 0 } },
        'fillet',
        5,
      ),
    ).toBeNull();
  });
});
