import { describe, expect, it } from 'vitest';

import type { Sketch, SketchCircle, SketchRectangle } from '../sketch-entity';
import { scaleEntities, scaleEntity } from './scale-entities';

const rect: SketchRectangle = {
  kind: 'rect',
  id: 'r',
  origin: { x: 10, y: 10 },
  widthMm: 40,
  heightMm: 20,
  cornerRadiusMm: 2,
};

const circle: SketchCircle = { kind: 'circle', id: 'c', center: { x: 50, y: 50 }, radiusMm: 10 };

describe('scaleEntity', () => {
  it('grows a rectangle about the anchor, corner radius included', () => {
    const scaled = scaleEntity(rect, { x: 10, y: 10 }, 2);
    if (scaled.kind !== 'rect') throw new Error('expected a rect');
    expect(scaled.origin).toEqual({ x: 10, y: 10 }); // the anchor holds still
    expect(scaled.widthMm).toBe(80);
    expect(scaled.heightMm).toBe(40);
    expect(scaled.cornerRadiusMm).toBe(4);
  });

  it('keeps a circle a circle', () => {
    const scaled = scaleEntity(circle, { x: 0, y: 0 }, 3);
    if (scaled.kind !== 'circle') throw new Error('expected a circle');
    expect(scaled.center).toEqual({ x: 150, y: 150 });
    expect(scaled.radiusMm).toBe(30);
  });

  it('moves a line’s endpoints about the anchor', () => {
    const scaled = scaleEntity(
      { kind: 'line', id: 'l', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { x: 0, y: 0 },
      2.5,
    );
    if (scaled.kind !== 'line') throw new Error('expected a line');
    expect(scaled.start).toEqual({ x: 0, y: 0 });
    expect(scaled.end).toEqual({ x: 25, y: 0 });
  });
});

describe('scaleEntities', () => {
  const sketch: Sketch = { entities: [rect, circle] };

  it('scales only the named entities', () => {
    const scaled = scaleEntities(sketch, new Set(['r']), { x: 10, y: 10 }, 2);
    expect(scaled.entities[0]).not.toBe(rect);
    expect(scaled.entities[1]).toBe(circle);
  });

  it('returns the same sketch for a no-op factor, empty ids, or unknown ids', () => {
    expect(scaleEntities(sketch, new Set(['r']), { x: 0, y: 0 }, 1)).toBe(sketch);
    expect(scaleEntities(sketch, new Set(), { x: 0, y: 0 }, 2)).toBe(sketch);
    expect(scaleEntities(sketch, new Set(['missing']), { x: 0, y: 0 }, 2)).toBe(sketch);
  });

  it('refuses a collapsed or non-finite factor rather than baking in a degenerate shape', () => {
    expect(scaleEntities(sketch, new Set(['r']), { x: 0, y: 0 }, 0)).toBe(sketch);
    expect(scaleEntities(sketch, new Set(['r']), { x: 0, y: 0 }, -2)).toBe(sketch);
    expect(scaleEntities(sketch, new Set(['r']), { x: 0, y: 0 }, Number.NaN)).toBe(sketch);
  });

  it('is reversible: scaling up then back down restores the geometry', () => {
    const up = scaleEntities(sketch, new Set(['r', 'c']), { x: 0, y: 0 }, 4);
    const back = scaleEntities(up, new Set(['r', 'c']), { x: 0, y: 0 }, 0.25);
    const restored = back.entities[0];
    if (restored?.kind !== 'rect') throw new Error('expected a rect');
    expect(restored.widthMm).toBeCloseTo(rect.widthMm, 9);
    expect(restored.origin.x).toBeCloseTo(rect.origin.x, 9);
  });
});
