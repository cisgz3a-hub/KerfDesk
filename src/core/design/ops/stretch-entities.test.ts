// The exactness contract of a per-axis stretch (ADR-272 Amendment 4). Each case
// below pins ONE kind's answer to "what can you honestly become when one axis
// grows and the other does not".

import { describe, expect, it } from 'vitest';
import { entityToPolylines } from '../entity-geometry';
import type { Sketch, SketchEntity } from '../sketch-entity';
import { stretchEntities, stretchEntity } from './stretch-entities';

const ORIGIN = { x: 0, y: 0 };
const WIDER = { x: 2, y: 1 };

const circle: SketchEntity = { kind: 'circle', id: 'c', center: { x: 10, y: 10 }, radiusMm: 5 };
const rect: SketchEntity = {
  kind: 'rect',
  id: 'r',
  origin: { x: 10, y: 10 },
  widthMm: 20,
  heightMm: 10,
  cornerRadiusMm: 2,
};
const arc: SketchEntity = {
  kind: 'arc',
  id: 'a',
  center: { x: 10, y: 10 },
  radiusMm: 5,
  startAngleDeg: 0,
  sweepDeg: 90,
};

describe('stretching a circle', () => {
  it('produces an ellipse with independent radii', () => {
    const out = stretchEntity(circle, ORIGIN, WIDER);
    if (out.kind !== 'ellipse') throw new Error('expected an ellipse');
    expect(out.radiusXMm).toBe(10);
    expect(out.radiusYMm).toBe(5);
    expect(out.center).toEqual({ x: 20, y: 10 });
  });

  it('stays a circle under equal factors, so a corner grip never converts it', () => {
    const out = stretchEntity(circle, ORIGIN, { x: 2, y: 2 });
    expect(out.kind).toBe('circle');
  });

  it('is reversible: stretching back restores the original radii', () => {
    const wide = stretchEntity(circle, ORIGIN, WIDER);
    const back = stretchEntity(wide, ORIGIN, { x: 0.5, y: 1 });
    if (back.kind !== 'ellipse') throw new Error('expected an ellipse');
    expect(back.radiusXMm).toBeCloseTo(5, 9);
    expect(back.radiusYMm).toBeCloseTo(5, 9);
  });
});

describe('stretching a rectangle', () => {
  it('scales each side by its own factor', () => {
    const out = stretchEntity(rect, ORIGIN, WIDER);
    if (out.kind !== 'rect') throw new Error('expected a rect');
    expect(out.widthMm).toBe(40);
    expect(out.heightMm).toBe(10);
  });

  // A true stretch makes the corners elliptical, which RectangleSpec cannot
  // hold; the smaller factor is the choice that keeps the fillet inside the
  // shorter side and agrees with the uniform case when the factors match.
  it('follows the smaller factor with the corner radius', () => {
    const out = stretchEntity(rect, ORIGIN, WIDER);
    if (out.kind !== 'rect') throw new Error('expected a rect');
    expect(out.cornerRadiusMm).toBe(2);
    const shrunk = stretchEntity(rect, ORIGIN, { x: 2, y: 0.5 });
    if (shrunk.kind !== 'rect') throw new Error('expected a rect');
    expect(shrunk.cornerRadiusMm).toBe(1);
  });
});

describe('stretching an arc', () => {
  it('bakes to a path, because an elliptical arc is not representable', () => {
    const out = stretchEntity(arc, ORIGIN, WIDER);
    expect(out.kind).toBe('path');
  });

  it('keeps the geometry the arc actually swept', () => {
    const before = entityToPolylines(arc)[0];
    const out = stretchEntity(arc, ORIGIN, WIDER);
    if (out.kind !== 'path' || before === undefined) throw new Error('expected both');
    expect(out.points).toHaveLength(before.points.length);
    const first = before.points[0];
    const stretchedFirst = out.points[0];
    if (first === undefined || stretchedFirst === undefined) throw new Error('expected points');
    expect(stretchedFirst.x).toBeCloseTo(first.x * 2, 9);
    expect(stretchedFirst.y).toBeCloseTo(first.y, 9);
  });

  it('stays an arc under equal factors', () => {
    expect(stretchEntity(arc, ORIGIN, { x: 3, y: 3 }).kind).toBe('arc');
  });
});

describe('stretchEntities', () => {
  const sketch: Sketch = { entities: [circle, rect] };
  const ids = new Set(['c']);

  it('returns the same sketch when nothing would change', () => {
    expect(stretchEntities(sketch, ids, ORIGIN, { x: 1, y: 1 })).toBe(sketch);
    expect(stretchEntities(sketch, new Set(), ORIGIN, WIDER)).toBe(sketch);
    expect(stretchEntities(sketch, new Set(['missing']), ORIGIN, WIDER)).toBe(sketch);
  });

  it('refuses a collapsed or non-finite factor rather than baking a degenerate shape', () => {
    expect(stretchEntities(sketch, ids, ORIGIN, { x: 0, y: 1 })).toBe(sketch);
    expect(stretchEntities(sketch, ids, ORIGIN, { x: Number.NaN, y: 1 })).toBe(sketch);
    expect(stretchEntities(sketch, ids, { x: Number.NaN, y: 0 }, WIDER)).toBe(sketch);
  });

  it('touches only the named entities', () => {
    const out = stretchEntities(sketch, ids, ORIGIN, WIDER);
    expect(out.entities[0]?.kind).toBe('ellipse');
    expect(out.entities[1]).toBe(rect);
  });
});
