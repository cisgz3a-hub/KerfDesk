import { describe, expect, it } from 'vitest';
import type { Sketch } from '../sketch-entity';
import { translateEntities, translateEntity } from './translate-entities';

const sketch: Sketch = {
  entities: [
    {
      kind: 'rect',
      id: 'r',
      origin: { x: 10, y: 20 },
      widthMm: 50,
      heightMm: 30,
      cornerRadiusMm: 4,
    },
    { kind: 'circle', id: 'c', center: { x: 100, y: 100 }, radiusMm: 12 },
    { kind: 'line', id: 'l', start: { x: 0, y: 0 }, end: { x: 40, y: 40 } },
    {
      kind: 'arc',
      id: 'a',
      center: { x: 200, y: 50 },
      radiusMm: 15,
      startAngleDeg: 0,
      sweepDeg: 90,
    },
    {
      kind: 'path',
      id: 'p',
      points: [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 15 },
      ],
      closed: true,
    },
  ],
};

const delta = { x: 25, y: -10 };

describe('translateEntity — every kind carries position differently', () => {
  it('moves a rectangle by its origin, leaving size and radius alone', () => {
    const moved = translateEntity(sketch.entities[0]!, delta);
    if (moved.kind !== 'rect') throw new Error('expected rect');
    expect(moved.origin).toEqual({ x: 35, y: 10 });
    expect(moved.widthMm).toBe(50);
    expect(moved.cornerRadiusMm).toBe(4);
  });

  it('moves a circle by its centre, leaving the radius alone', () => {
    const moved = translateEntity(sketch.entities[1]!, delta);
    if (moved.kind !== 'circle') throw new Error('expected circle');
    expect(moved.center).toEqual({ x: 125, y: 90 });
    expect(moved.radiusMm).toBe(12);
  });

  it('moves both endpoints of a line, preserving its length and angle', () => {
    const moved = translateEntity(sketch.entities[2]!, delta);
    if (moved.kind !== 'line') throw new Error('expected line');
    expect(moved.start).toEqual({ x: 25, y: -10 });
    expect(moved.end).toEqual({ x: 65, y: 30 });
  });

  it('moves an arc by its centre, leaving radius and sweep alone', () => {
    const moved = translateEntity(sketch.entities[3]!, delta);
    if (moved.kind !== 'arc') throw new Error('expected arc');
    expect(moved.center).toEqual({ x: 225, y: 40 });
    expect(moved.sweepDeg).toBe(90);
    expect(moved.startAngleDeg).toBe(0);
  });

  it('moves every point of a path, preserving closure', () => {
    const moved = translateEntity(sketch.entities[4]!, delta);
    if (moved.kind !== 'path') throw new Error('expected path');
    expect(moved.points[0]).toEqual({ x: 30, y: -5 });
    expect(moved.points[2]).toEqual({ x: 40, y: 5 });
    expect(moved.closed).toBe(true);
  });
});

describe('translateEntities', () => {
  it('moves only the named ids', () => {
    const next = translateEntities(sketch, new Set(['r', 'c']), delta);
    const rect = next.entities[0];
    const circle = next.entities[1];
    const line = next.entities[2];
    if (rect?.kind !== 'rect' || circle?.kind !== 'circle' || line?.kind !== 'line') {
      throw new Error('unexpected kinds');
    }
    expect(rect.origin).toEqual({ x: 35, y: 10 });
    expect(circle.center).toEqual({ x: 125, y: 90 });
    // Untouched.
    expect(line.start).toEqual({ x: 0, y: 0 });
  });

  it('preserves entity order, so z-order survives a move', () => {
    const next = translateEntities(sketch, new Set(['c']), delta);
    expect(next.entities.map((entity) => entity.id)).toEqual(['r', 'c', 'l', 'a', 'p']);
  });

  // Returning the SAME object matters: a drag that has not moved yet must not read
  // as a change, or every pointer-down would dirty the sketch.
  it('returns the same sketch for a zero delta', () => {
    expect(translateEntities(sketch, new Set(['r']), { x: 0, y: 0 })).toBe(sketch);
  });

  it('returns the same sketch for an empty selection', () => {
    expect(translateEntities(sketch, new Set(), delta)).toBe(sketch);
  });

  it('returns the same sketch when no id matches', () => {
    expect(translateEntities(sketch, new Set(['ghost']), delta)).toBe(sketch);
  });

  it('ignores a non-finite delta rather than producing NaN geometry', () => {
    expect(translateEntities(sketch, new Set(['r']), { x: Number.NaN, y: 0 })).toBe(sketch);
    expect(translateEntities(sketch, new Set(['r']), { x: 0, y: Number.POSITIVE_INFINITY })).toBe(
      sketch,
    );
  });

  it('does not mutate the input', () => {
    translateEntities(sketch, new Set(['r']), delta);
    const rect = sketch.entities[0];
    if (rect?.kind !== 'rect') throw new Error('expected rect');
    expect(rect.origin).toEqual({ x: 10, y: 20 });
  });

  it('round-trips: moving by a delta and back restores the original positions', () => {
    const there = translateEntities(sketch, new Set(['r', 'c', 'l', 'a', 'p']), delta);
    const back = translateEntities(there, new Set(['r', 'c', 'l', 'a', 'p']), {
      x: -delta.x,
      y: -delta.y,
    });
    expect(back).toEqual(sketch);
  });
});
