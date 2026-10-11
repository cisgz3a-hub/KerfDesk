import { describe, expect, it } from 'vitest';
import { entityBounds } from '../sketch-bounds';
import type { Sketch, SketchRectangle } from '../sketch-entity';
import { alignEntities, distributeEntities, type DesignAlignKind } from './arrange-entities';

function rect(id: string, x: number, y: number, width = 10): SketchRectangle {
  return { id, kind: 'rect', origin: { x, y }, widthMm: width, heightMm: 10, cornerRadiusMm: 2 };
}

describe('selection alignment', () => {
  it.each<DesignAlignKind>(['left', 'center-x', 'right', 'top', 'center-y', 'bottom'])(
    'aligns mixed shapes by %s without altering their shape or metadata',
    (kind) => {
      const sketch: Sketch = {
        entities: [
          { ...rect('r', 10, 20), layerId: 'cut', construction: true },
          { id: 'c', kind: 'circle', center: { x: 60, y: 70 }, radiusMm: 5 },
          rect('outside', 300, 400),
        ],
      };
      const next = alignEntities(sketch, new Set(['r', 'c', 'missing']), kind);
      const [a, b] = next.entities.slice(0, 2).map(entityBounds);
      const expected = {
        left: 10,
        'center-x': 37.5,
        right: 65,
        top: 20,
        'center-y': 47.5,
        bottom: 75,
      }[kind];
      for (const box of [a!, b!]) {
        const actual = {
          left: box.minX,
          'center-x': (box.minX + box.maxX) / 2,
          right: box.maxX,
          top: box.minY,
          'center-y': (box.minY + box.maxY) / 2,
          bottom: box.maxY,
        }[kind];
        expect(actual).toBe(expected);
      }
      expect(next.entities[0]).toMatchObject({
        widthMm: 10,
        heightMm: 10,
        cornerRadiusMm: 2,
        layerId: 'cut',
        construction: true,
      });
      expect(next.entities[1]).toMatchObject({ radiusMm: 5 });
      expect(next.entities[2]).toBe(sketch.entities[2]);
      expect(alignEntities(next, new Set(['r', 'c']), kind)).toBe(next);
    },
  );

  it('requires two real entities and preserves empty or stale selections', () => {
    const sketch: Sketch = { entities: [rect('a', 0, 0)] };
    expect(alignEntities(sketch, new Set(['a', 'missing']), 'left')).toBe(sketch);
    expect(alignEntities(sketch, new Set(), 'left')).toBe(sketch);
  });
});

describe('selection distribution', () => {
  it.each(['horizontal', 'vertical'] as const)(
    'spaces unequal %s objects with outer items fixed',
    (axis) => {
      const sketch: Sketch = {
        entities: [rect('a', 0, 0, 10), rect('b', 20, 20, 20), rect('c', 100, 100, 30)],
      };
      const next = distributeEntities(sketch, new Set(['a', 'b', 'c']), `${axis}-spacing`);
      const [a, b, c] = next.entities.map(entityBounds);
      const [min, max] =
        axis === 'horizontal' ? (['minX', 'maxX'] as const) : (['minY', 'maxY'] as const);
      expect(b![min] - a![max]).toBeCloseTo(c![min] - b![max]);
      expect(next.entities[0]).toBe(sketch.entities[0]);
      expect(next.entities[2]).toBe(sketch.entities[2]);
      expect(distributeEntities(next, new Set(['a', 'b', 'c']), `${axis}-spacing`)).toBe(next);
    },
  );

  it.each(['horizontal', 'vertical'] as const)(
    'distributes %s centres in spatial rather than selection order',
    (axis) => {
      const sketch: Sketch = {
        entities: [rect('c', 100, 100, 30), rect('a', 0, 0), rect('b', 20, 20, 20)],
      };
      const next = distributeEntities(sketch, new Set(['b', 'c', 'a']), `${axis}-centers`);
      const [c, a, b] = next.entities.map(entityBounds);
      const center = (box: NonNullable<typeof a>): number =>
        axis === 'horizontal' ? (box.minX + box.maxX) / 2 : (box.minY + box.maxY) / 2;
      expect(center(b!) - center(a!)).toBeCloseTo(center(c!) - center(b!));
      expect(next.entities.map((entity) => entity.id)).toEqual(['c', 'a', 'b']);
    },
  );

  it('ignores stale ids when counting the three required objects', () => {
    const sketch: Sketch = { entities: [rect('a', 0, 0), rect('b', 20, 20)] };
    expect(distributeEntities(sketch, new Set(['a', 'b', 'missing']), 'horizontal-centers')).toBe(
      sketch,
    );
  });
});
