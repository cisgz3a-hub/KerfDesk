import { describe, expect, it } from 'vitest';
import { isDrawDragSignificant, MIN_DRAW_SIZE_MM, shapeFromDrag } from './shape-from-drag';

describe('shapeFromDrag', () => {
  it('fills the drag box for a rectangle, anchored at the top-left corner', () => {
    const shape = shapeFromDrag({
      kind: 'rect',
      start: { x: 10, y: 20 },
      end: { x: 40, y: 60 },
      id: 'R1',
      color: '#ff0000',
    });
    expect(shape.kind).toBe('shape');
    expect(shape.id).toBe('R1');
    expect(shape.color).toBe('#ff0000');
    expect(shape.spec).toEqual({ kind: 'rect', widthMm: 30, heightMm: 40, cornerRadiusMm: 0 });
    expect(shape.transform.x).toBe(10);
    expect(shape.transform.y).toBe(20);
  });

  it('normalizes a bottom-right-to-top-left drag to the same rectangle', () => {
    const shape = shapeFromDrag({
      kind: 'rect',
      start: { x: 40, y: 60 },
      end: { x: 10, y: 20 },
      id: 'R2',
      color: '#000000',
    });
    expect(shape.spec).toEqual({ kind: 'rect', widthMm: 30, heightMm: 40, cornerRadiusMm: 0 });
    // Transform anchors at the box's min corner regardless of drag direction.
    expect(shape.transform.x).toBe(10);
    expect(shape.transform.y).toBe(20);
  });

  it('fills the drag box for an ellipse', () => {
    const shape = shapeFromDrag({
      kind: 'ellipse',
      start: { x: 0, y: 0 },
      end: { x: 50, y: 30 },
      id: 'E1',
      color: '#00ff00',
    });
    expect(shape.spec).toEqual({ kind: 'ellipse', widthMm: 50, heightMm: 30 });
    expect(shape.transform.x).toBe(0);
    expect(shape.transform.y).toBe(0);
  });

  it('inscribes a centered hexagon in the drag box for a polygon', () => {
    const shape = shapeFromDrag({
      kind: 'polygon',
      start: { x: 0, y: 0 },
      end: { x: 40, y: 20 },
      id: 'P1',
      color: '#0000ff',
    });
    // radius = min(40, 20) / 2 = 10; default 6 sides.
    expect(shape.spec).toEqual({ kind: 'polygon', sides: 6, radiusMm: 10 });
    // Centre the local (radius,radius) point at the box centre (20,10).
    expect(shape.transform.x).toBe(10);
    expect(shape.transform.y).toBe(0);
  });
});

describe('isDrawDragSignificant', () => {
  it('rejects a click (both axes below the threshold)', () => {
    expect(isDrawDragSignificant({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(false);
    expect(isDrawDragSignificant({ x: 0, y: 0 }, { x: 0.4, y: 0.4 })).toBe(false);
  });

  it('accepts a drag that clears the threshold on either axis', () => {
    expect(isDrawDragSignificant({ x: 0, y: 0 }, { x: MIN_DRAW_SIZE_MM, y: 0 })).toBe(true);
    expect(isDrawDragSignificant({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(true);
  });
});
