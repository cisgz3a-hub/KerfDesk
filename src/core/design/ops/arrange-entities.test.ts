import { describe, expect, it } from 'vitest';
import { entityBounds } from '../sketch-bounds';
import type { Sketch, SketchEntity, SketchRectangle } from '../sketch-entity';
import { alignEntities, distributeEntities, type DesignAlignKind } from './arrange-entities';

function rect(id: string, x: number, y: number, width = 10): SketchRectangle {
  return { id, kind: 'rect', origin: { x, y }, widthMm: width, heightMm: 10, cornerRadiusMm: 2 };
}

const nondrawable: readonly SketchEntity[] = [
  { id: 'empty', kind: 'path', points: [], closed: false },
  { id: 'point', kind: 'path', points: [{ x: -100, y: -100 }], closed: false },
  { id: 'circle', kind: 'circle', center: { x: -100, y: -100 }, radiusMm: 0 },
  {
    id: 'rect',
    kind: 'rect',
    origin: { x: -100, y: -100 },
    widthMm: 0,
    heightMm: 5,
    cornerRadiusMm: 0,
  },
  { id: 'ellipse', kind: 'ellipse', center: { x: -100, y: -100 }, radiusXMm: 5, radiusYMm: 0 },
  { id: 'line', kind: 'line', start: { x: -100, y: -100 }, end: { x: -100, y: -100 } },
  {
    id: 'arc',
    kind: 'arc',
    center: { x: -100, y: -100 },
    radiusMm: 5,
    startAngleDeg: 0,
    sweepDeg: 0,
  },
];

const selectAll = (sketch: Sketch): ReadonlySet<string> =>
  new Set(sketch.entities.map((entity) => entity.id));

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

  it.each<DesignAlignKind>(['left', 'center-x', 'right', 'top', 'center-y', 'bottom'])(
    '%s ignores non-drawable geometry in bounds and minimum selection size',
    (kind) => {
      const visible: Sketch = { entities: [rect('a', 100, 100), rect('b', 180, 180)] };
      const mixed: Sketch = { entities: [...visible.entities, ...nondrawable] };
      const next = alignEntities(mixed, selectAll(mixed), kind);
      expect(next.entities.slice(0, 2)).toEqual(
        alignEntities(visible, selectAll(visible), kind).entities,
      );
      nondrawable.forEach((entity, index) => expect(next.entities[index + 2]).toBe(entity));
      const single: Sketch = { entities: [rect('single', 100, 100), ...nondrawable] };
      expect(alignEntities(single, selectAll(single), kind)).toBe(single);
      const empty: Sketch = { entities: nondrawable };
      expect(alignEntities(empty, selectAll(empty), kind)).toBe(empty);
    },
  );

  it('moves the sanitized drawable path rather than retaining invalid transient points', () => {
    const path: SketchEntity = {
      id: 'path',
      kind: 'path',
      layerId: 'cut',
      construction: true,
      closed: false,
      points: [
        { x: NaN, y: 0 },
        { x: 30, y: 30 },
        { x: 40, y: 40 },
      ],
    };
    const sketch: Sketch = { entities: [rect('anchor', 10, 10), path] };
    const next = alignEntities(sketch, selectAll(sketch), 'left');
    expect(next.entities[0]).toBe(sketch.entities[0]);
    expect(next.entities[1]).toEqual({
      ...path,
      points: [
        { x: 10, y: 30 },
        { x: 20, y: 40 },
      ],
    });
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

  it.each([
    'horizontal-centers',
    'horizontal-spacing',
    'vertical-centers',
    'vertical-spacing',
  ] as const)('%s ignores non-drawable geometry in positions and item count', (kind) => {
    const visible: Sketch = {
      entities: [rect('a', 100, 100), rect('b', 120, 120, 20), rect('c', 200, 200, 30)],
    };
    const mixed: Sketch = { entities: [...visible.entities, ...nondrawable] };
    const next = distributeEntities(mixed, selectAll(mixed), kind);
    expect(next.entities.slice(0, 3)).toEqual(
      distributeEntities(visible, selectAll(visible), kind).entities,
    );
    nondrawable.forEach((entity, index) => expect(next.entities[index + 3]).toBe(entity));
    const pair: Sketch = { entities: [...visible.entities.slice(0, 2), ...nondrawable] };
    expect(distributeEntities(pair, selectAll(pair), kind)).toBe(pair);
    const empty: Sketch = { entities: nondrawable };
    expect(distributeEntities(empty, selectAll(empty), kind)).toBe(empty);
  });

  it('distributes the sanitized drawable path without retaining invalid transient points', () => {
    const path: SketchEntity = {
      id: 'path',
      kind: 'path',
      closed: false,
      points: [
        { x: 20, y: 20 },
        { x: Infinity, y: 0 },
        { x: 30, y: 30 },
      ],
    };
    const sketch: Sketch = { entities: [rect('first', 0, 0), path, rect('last', 100, 100)] };
    const next = distributeEntities(sketch, selectAll(sketch), 'horizontal-centers');
    expect(next.entities[0]).toBe(sketch.entities[0]);
    expect(next.entities[2]).toBe(sketch.entities[2]);
    expect(next.entities[1]).toEqual({
      ...path,
      points: [
        { x: 50, y: 20 },
        { x: 60, y: 30 },
      ],
    });
  });
});
