import { describe, expect, it } from 'vitest';
import {
  boundsHeightMm,
  boundsWidthMm,
  EMPTY_BOUNDS,
  entityBounds,
  outputSketchBounds,
  sketchBounds,
} from './sketch-bounds';
import type { Sketch, SketchArc, SketchCircle, SketchLine } from './sketch-entity';

const circle: SketchCircle = {
  kind: 'circle',
  id: 'c1',
  center: { x: 0, y: 0 },
  radiusMm: 10,
};

const quarterArc: SketchArc = {
  kind: 'arc',
  id: 'a1',
  center: { x: 0, y: 0 },
  radiusMm: 10,
  startAngleDeg: 0,
  sweepDeg: 90,
};

describe('entityBounds', () => {
  it('boxes a circle at its radius', () => {
    const bounds = entityBounds(circle);
    expect(bounds.minX).toBeCloseTo(-10, 4);
    expect(bounds.maxX).toBeCloseTo(10, 4);
    expect(boundsWidthMm(bounds)).toBeCloseTo(20, 4);
    expect(boundsHeightMm(bounds)).toBeCloseTo(20, 4);
  });

  it('boxes an arc by what it sweeps, not by its whole circle', () => {
    const bounds = entityBounds(quarterArc);
    expect(bounds.minX).toBeCloseTo(0, 4);
    expect(bounds.minY).toBeCloseTo(0, 4);
    expect(bounds.maxX).toBeCloseTo(10, 4);
    expect(bounds.maxY).toBeCloseTo(10, 4);
  });

  it('returns empty bounds for a degenerate entity', () => {
    const dead: SketchLine = {
      kind: 'line',
      id: 'dead',
      start: { x: 3, y: 3 },
      end: { x: 3, y: 3 },
    };
    expect(entityBounds(dead)).toEqual(EMPTY_BOUNDS);
  });
});

describe('sketchBounds', () => {
  it('unions every entity', () => {
    const sketch: Sketch = {
      entities: [circle, { kind: 'line', id: 'l1', start: { x: 40, y: 0 }, end: { x: 50, y: 5 } }],
    };
    const bounds = sketchBounds(sketch);
    expect(bounds.minX).toBeCloseTo(-10, 4);
    expect(bounds.maxX).toBeCloseTo(50, 4);
    expect(bounds.maxY).toBeCloseTo(10, 4);
  });

  it('is empty for an empty sketch', () => {
    expect(sketchBounds({ entities: [] })).toEqual(EMPTY_BOUNDS);
  });
});

describe('outputSketchBounds', () => {
  const sketch: Sketch = {
    entities: [
      circle,
      {
        kind: 'line',
        id: 'guide',
        start: { x: 100, y: 100 },
        end: { x: 200, y: 200 },
        construction: true,
      },
    ],
  };

  it('excludes construction geometry', () => {
    const bounds = outputSketchBounds(sketch);
    expect(bounds.maxX).toBeCloseTo(10, 4);
    expect(bounds.maxY).toBeCloseTo(10, 4);
  });

  it('differs from sketchBounds, which frames guides too', () => {
    expect(sketchBounds(sketch).maxX).toBeCloseTo(200, 4);
  });

  it('is empty when every entity is construction', () => {
    expect(outputSketchBounds({ entities: [{ ...circle, construction: true }] })).toEqual(
      EMPTY_BOUNDS,
    );
  });
});
