import { describe, expect, it } from 'vitest';
import { transformedBBox, type ShapeObject } from '../scene';
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

  it('fills the visual drag box for a polygon', () => {
    const shape = shapeFromDrag({
      kind: 'polygon',
      start: { x: 0, y: 0 },
      end: { x: 40, y: 20 },
      id: 'P1',
      color: '#0000ff',
    });
    expect(shape.spec.kind).toBe('polygon');
    if (shape.spec.kind !== 'polygon') throw new Error('expected polygon shape');
    expect(shape.spec.sides).toBe(6);
    expectShapeBox(shape, { minX: 0, minY: 0, maxX: 40, maxY: 20 });
  });

  it('fills the visual drag box for a star', () => {
    const shape = shapeFromDrag({
      kind: 'star',
      start: { x: 0, y: 0 },
      end: { x: 40, y: 40 },
      id: 'S1',
      color: '#ffff00',
    });

    expect(shape.spec.kind).toBe('star');
    if (shape.spec.kind !== 'star') throw new Error('expected star shape');
    expect(shape.spec.points).toBe(5);
    expect(shape.spec.innerRadiusRatio).toBeCloseTo(0.5, 5);
    expectShapeBox(shape, { minX: 0, minY: 0, maxX: 40, maxY: 40 });
  });

  it('uses Ctrl/Cmd-style center-out drawing when requested', () => {
    const shape = shapeFromDrag({
      kind: 'ellipse',
      start: { x: 50, y: 50 },
      end: { x: 70, y: 60 },
      id: 'E2',
      color: '#00ff00',
      modifiers: { fromCenter: true },
    });
    expect(shape.spec).toEqual({ kind: 'ellipse', widthMm: 40, heightMm: 20 });
    expect(shape.transform.x).toBe(30);
    expect(shape.transform.y).toBe(40);
  });

  it('uses Shift-style regular drawing when requested', () => {
    const shape = shapeFromDrag({
      kind: 'rect',
      start: { x: 10, y: 20 },
      end: { x: 40, y: 30 },
      id: 'R3',
      color: '#ff0000',
      modifiers: { regular: true },
    });
    expect(shape.spec).toEqual({ kind: 'rect', widthMm: 30, heightMm: 30, cornerRadiusMm: 0 });
    expect(shape.transform.x).toBe(10);
    expect(shape.transform.y).toBe(20);
  });

  it('combines center-out and regular modifiers', () => {
    const shape = shapeFromDrag({
      kind: 'rect',
      start: { x: 50, y: 50 },
      end: { x: 70, y: 60 },
      id: 'R4',
      color: '#ff0000',
      modifiers: { fromCenter: true, regular: true },
    });
    expect(shape.spec).toEqual({ kind: 'rect', widthMm: 40, heightMm: 40, cornerRadiusMm: 0 });
    expect(shape.transform.x).toBe(30);
    expect(shape.transform.y).toBe(30);
  });
});

describe('isDrawDragSignificant', () => {
  it('rejects a click (both axes below the threshold)', () => {
    expect(isDrawDragSignificant({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(false);
    expect(isDrawDragSignificant({ x: 0, y: 0 }, { x: 0.4, y: 0.4 })).toBe(false);
  });

  it('rejects a zero-area drag for non-regular closed shapes', () => {
    expect(isDrawDragSignificant({ x: 0, y: 0 }, { x: MIN_DRAW_SIZE_MM, y: 0 })).toBe(false);
    expect(isDrawDragSignificant({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(false);
  });

  it('accepts an intentionally thin non-regular shape when the drag is otherwise clear', () => {
    expect(isDrawDragSignificant({ x: 0, y: 0 }, { x: 0.1, y: 10 })).toBe(true);
  });

  it('accepts a one-axis Shift-style regular drag because it can become square/circle', () => {
    expect(
      isDrawDragSignificant({ x: 0, y: 0 }, { x: MIN_DRAW_SIZE_MM, y: 0 }, { regular: true }),
    ).toBe(true);
    expect(isDrawDragSignificant({ x: 0, y: 0 }, { x: 0, y: 10 }, { regular: true })).toBe(true);
  });

  it('accepts a drag that clears the threshold on both axes', () => {
    expect(isDrawDragSignificant({ x: 0, y: 0 }, { x: MIN_DRAW_SIZE_MM, y: 10 })).toBe(true);
  });
});

function expectShapeBox(
  shape: ShapeObject,
  expected: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  },
): void {
  const actual = transformedBBox(shape);
  expect(actual.minX).toBeCloseTo(expected.minX, 5);
  expect(actual.minY).toBeCloseTo(expected.minY, 5);
  expect(actual.maxX).toBeCloseTo(expected.maxX, 5);
  expect(actual.maxY).toBeCloseTo(expected.maxY, 5);
}
