import { describe, expect, it } from 'vitest';
import type { Sketch, SketchArc, SketchEntity } from '../sketch-entity';
import { transformSelection, type DesignTransformKind } from './transform-selection';

const kinds: DesignTransformKind[] = [
  'rotate-left',
  'rotate-right',
  'flip-horizontal',
  'flip-vertical',
];
const rect: SketchEntity = {
  id: 'rect',
  kind: 'rect',
  origin: { x: 10, y: 20 },
  widthMm: 20,
  heightMm: 10,
  cornerRadiusMm: 2,
  layerId: 'engrave',
  construction: true,
};
const arc: SketchArc = {
  id: 'arc',
  kind: 'arc',
  center: { x: 30, y: 30 },
  radiusMm: 8,
  startAngleDeg: 17,
  sweepDeg: -217,
};
const mixed: Sketch = {
  entities: [
    rect,
    arc,
    { id: 'circle', kind: 'circle', center: { x: 42, y: 51 }, radiusMm: 7 },
    { id: 'ellipse', kind: 'ellipse', center: { x: 71, y: 14 }, radiusXMm: 11, radiusYMm: 3 },
    { id: 'line', kind: 'line', start: { x: -12, y: -4 }, end: { x: 23, y: -2 } },
    {
      id: 'path',
      kind: 'path',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 3 },
        { x: 4, y: 2 },
      ],
      closed: true,
    },
  ],
};
const all = new Set(mixed.entities.map((entity) => entity.id));

function expectClose(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') {
    expect(actual).toBeCloseTo(expected, 9);
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    expect(Object.keys(actual as object)).toEqual(Object.keys(expected));
    for (const key of Object.keys(expected)) {
      expectClose(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
      );
    }
    return;
  }
  expect(actual).toEqual(expected);
}

describe('quarter turn and mirror selection', () => {
  it('transforms the same finite path vertices that materialization uses', () => {
    const clean: SketchEntity = {
      id: 'path',
      kind: 'path',
      closed: false,
      points: [
        { x: 100, y: 100 },
        { x: 120, y: 110 },
      ],
    };
    const recoverable = { ...clean, points: [{ x: Number.NaN, y: 0 }, ...clean.points] };
    const selected = new Set(['rect', 'path']);
    expect(transformSelection({ entities: [rect, recoverable] }, selected, 'rotate-right')).toEqual(
      transformSelection({ entities: [rect, clean] }, selected, 'rotate-right'),
    );
  });

  it.each(kinds)('%s ignores non-materialized selected entities', (kind) => {
    const empty: SketchEntity[] = [
      { id: 'empty', kind: 'path', points: [], closed: false },
      { id: 'zero', kind: 'circle', center: { x: -1000, y: -1000 }, radiusMm: 0 },
      {
        id: 'flat',
        kind: 'rect',
        origin: { x: 500, y: 500 },
        widthMm: 0,
        heightMm: 20,
        cornerRadiusMm: 0,
      },
    ];
    const sketch: Sketch = { entities: [rect, ...empty] };
    const next = transformSelection(
      sketch,
      new Set(sketch.entities.map((entity) => entity.id)),
      kind,
    );
    expect(next.entities[0]).toEqual(
      transformSelection({ entities: [rect] }, new Set([rect.id]), kind).entities[0],
    );
    expect(next.entities.slice(1)).toEqual(empty);
    const onlyEmpty = { entities: empty };
    expect(transformSelection(onlyEmpty, new Set(empty.map((entity) => entity.id)), kind)).toBe(
      onlyEmpty,
    );
  });

  it('turns a rounded rectangle clockwise around its centre while keeping it editable', () => {
    const sketch = { entities: [rect] };
    const next = transformSelection(sketch, new Set(['rect']), 'rotate-right');
    expect(next.entities[0]).toEqual({
      ...rect,
      origin: { x: 15, y: 15 },
      widthMm: 10,
      heightMm: 20,
    });
    expect(transformSelection(next, new Set(['rect']), 'rotate-left')).toEqual(sketch);
  });

  it('rotates a mixed selection around one centre, leaves other objects and drawing order intact', () => {
    const outside: SketchEntity = {
      id: 'outside',
      kind: 'circle',
      center: { x: 999, y: 999 },
      radiusMm: 1,
    };
    const sketch = {
      entities: [
        rect,
        outside,
        { id: 'line', kind: 'line' as const, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      ],
    };
    // Selected bounds [0,0] to [30,30], pivot [15,15].
    const next = transformSelection(sketch, new Set(['rect', 'line', 'stale']), 'rotate-right');
    expect(next.entities[0]).toEqual({
      ...rect,
      origin: { x: 0, y: 10 },
      widthMm: 10,
      heightMm: 20,
    });
    expect(next.entities[1]).toBe(outside);
    expect(next.entities[2]).toMatchObject({ start: { x: 30, y: 0 }, end: { x: 30, y: 10 } });
    expect(next.entities.map((entity) => entity.id)).toEqual(['rect', 'outside', 'line']);
  });

  it.each(kinds)(
    '%s is reversible without changing types, metadata, radii or path vertices',
    (kind) => {
      const inverse: DesignTransformKind =
        kind === 'rotate-left' ? 'rotate-right' : kind === 'rotate-right' ? 'rotate-left' : kind;
      const next = transformSelection(mixed, all, kind);
      expect(next.entities.map((entity) => entity.kind)).toEqual(
        mixed.entities.map((entity) => entity.kind),
      );
      expectClose(transformSelection(next, all, inverse), mixed);
    },
  );

  it('four quarter turns keep curved selections in place instead of drifting with arc tessellation', () => {
    let sketch = mixed;
    for (let turn = 0; turn < 4; turn += 1)
      sketch = transformSelection(sketch, all, 'rotate-right');
    expectClose(sketch, mixed);
  });

  it('swaps ellipse axes and turns path vertices without reordering or closing an open path', () => {
    const sketch: Sketch = {
      entities: [
        { id: 'ellipse', kind: 'ellipse', center: { x: 0, y: 0 }, radiusXMm: 10, radiusYMm: 5 },
        {
          id: 'path',
          kind: 'path',
          points: [
            { x: -2, y: -1 },
            { x: 4, y: 2 },
          ],
          closed: false,
        },
      ],
    };
    const next = transformSelection(sketch, new Set(['ellipse', 'path']), 'rotate-right');
    expect(next.entities).toEqual([
      { id: 'ellipse', kind: 'ellipse', center: { x: 0, y: 0 }, radiusXMm: 5, radiusYMm: 10 },
      {
        id: 'path',
        kind: 'path',
        points: [
          { x: 1, y: -2 },
          { x: -2, y: 4 },
        ],
        closed: false,
      },
    ]);
  });

  it.each(['flip-horizontal', 'flip-vertical'] as const)(
    '%s mirrors every arc point and reverses its sweep',
    (kind) => {
      // Bounding guide fixes the shared pivot at [0,0], independently of arc bounds.
      const guide: SketchEntity = {
        id: 'guide',
        kind: 'rect',
        origin: { x: -100, y: -100 },
        widthMm: 200,
        heightMm: 200,
        cornerRadiusMm: 0,
      };
      const transformed = transformSelection(
        { entities: [arc, guide] },
        new Set(['arc', 'guide']),
        kind,
      ).entities[0] as SketchArc;
      expect(transformed.sweepDeg).toBe(-arc.sweepDeg);
      for (const fraction of [0, 0.1, 0.5, 0.9, 1]) {
        const before = ((arc.startAngleDeg + arc.sweepDeg * fraction) * Math.PI) / 180;
        const after =
          ((transformed.startAngleDeg + transformed.sweepDeg * fraction) * Math.PI) / 180;
        const x = arc.center.x + arc.radiusMm * Math.cos(before);
        const y = arc.center.y + arc.radiusMm * Math.sin(before);
        expect(transformed.center.x + transformed.radiusMm * Math.cos(after)).toBeCloseTo(
          kind === 'flip-horizontal' ? -x : x,
          10,
        );
        expect(transformed.center.y + transformed.radiusMm * Math.sin(after)).toBeCloseTo(
          kind === 'flip-vertical' ? -y : y,
          10,
        );
      }
    },
  );

  it.each(kinds)('%s leaves a single circle and empty or stale selections unchanged', (kind) => {
    const sketch: Sketch = {
      entities: [{ id: 'circle', kind: 'circle', center: { x: 2, y: 3 }, radiusMm: 4 }],
    };
    expect(transformSelection(sketch, new Set(['circle']), kind)).toBe(sketch);
    expect(transformSelection(sketch, new Set(['absent']), kind)).toBe(sketch);
    expect(transformSelection(sketch, new Set(), kind)).toBe(sketch);
  });
});
