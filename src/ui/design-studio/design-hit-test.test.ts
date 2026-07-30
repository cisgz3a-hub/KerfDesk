import { describe, expect, it } from 'vitest';
import type {
  Sketch,
  SketchArc,
  SketchCircle,
  SketchLine,
  SketchRectangle,
} from '../../core/design';
import { distanceToSegment, entitiesInRectMm, hitTestSketch, isEntityHit } from './design-hit-test';

const horizontal: SketchLine = {
  kind: 'line',
  id: 'h',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
};

describe('distanceToSegment', () => {
  it('measures perpendicular distance inside the segment', () => {
    expect(distanceToSegment({ x: 50, y: 5 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(5, 9);
  });

  it('clamps to the endpoints rather than the infinite line', () => {
    expect(distanceToSegment({ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(
      10,
      9,
    );
  });

  it('handles a zero-length segment', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5, 9);
  });
});

describe('isEntityHit', () => {
  it('hits within tolerance and misses outside it', () => {
    expect(isEntityHit(horizontal, { x: 50, y: 0.5 }, 1)).toBe(true);
    expect(isEntityHit(horizontal, { x: 50, y: 3 }, 1)).toBe(false);
  });

  it('does not hit past the end of a line', () => {
    expect(isEntityHit(horizontal, { x: 130, y: 0 }, 1)).toBe(false);
  });

  it('hits a circle on its rim AND anywhere inside it', () => {
    const circle: SketchCircle = { kind: 'circle', id: 'c', center: { x: 0, y: 0 }, radiusMm: 20 };
    expect(isEntityHit(circle, { x: 20, y: 0 }, 1)).toBe(true);
    // Interior picking, added deliberately: outline-only picking made shapes
    // impossible to grab and move.
    expect(isEntityHit(circle, { x: 0, y: 0 }, 1)).toBe(true);
    expect(isEntityHit(circle, { x: 40, y: 0 }, 1)).toBe(false);
  });

  it('hits an arc only along the arc it sweeps', () => {
    const quarter: SketchArc = {
      kind: 'arc',
      id: 'a',
      center: { x: 0, y: 0 },
      radiusMm: 10,
      startAngleDeg: 0,
      sweepDeg: 90,
    };
    // On the swept quadrant.
    expect(isEntityHit(quarter, { x: 7.07, y: 7.07 }, 0.5)).toBe(true);
    // On the circle but outside the sweep.
    expect(isEntityHit(quarter, { x: -10, y: 0 }, 0.5)).toBe(false);
  });

  it('never hits a degenerate entity', () => {
    const dead: SketchLine = { kind: 'line', id: 'd', start: { x: 5, y: 5 }, end: { x: 5, y: 5 } };
    expect(isEntityHit(dead, { x: 5, y: 5 }, 5)).toBe(false);
  });
});

describe('hitTestSketch', () => {
  const stacked: Sketch = {
    entities: [
      horizontal,
      { kind: 'line', id: 'top', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    ],
  };

  it('returns the topmost entity, since order is z-order', () => {
    expect(hitTestSketch(stacked, { x: 50, y: 0 }, 1)?.id).toBe('top');
  });

  it('returns null on empty space', () => {
    expect(hitTestSketch(stacked, { x: 50, y: 90 }, 1)).toBeNull();
  });

  it('returns null for an empty sketch', () => {
    expect(hitTestSketch({ entities: [] }, { x: 0, y: 0 }, 1)).toBeNull();
  });
});

describe('entitiesInRectMm', () => {
  const sketch: Sketch = {
    entities: [
      horizontal,
      { kind: 'line', id: 'far', start: { x: 500, y: 500 }, end: { x: 600, y: 500 } },
    ],
  };

  it('encloses, it does not merely touch', () => {
    // Fully contains the horizontal line.
    expect(entitiesInRectMm(sketch, { x: -5, y: -5 }, { x: 105, y: 5 }).map((e) => e.id)).toEqual([
      'h',
    ]);
    // Overlaps it but does not contain it.
    expect(entitiesInRectMm(sketch, { x: -5, y: -5 }, { x: 50, y: 5 })).toHaveLength(0);
  });

  it('works with the corners given in any order', () => {
    expect(entitiesInRectMm(sketch, { x: 105, y: 5 }, { x: -5, y: -5 })).toHaveLength(1);
  });

  it('returns nothing for an empty rectangle', () => {
    expect(entitiesInRectMm(sketch, { x: 0, y: 0 }, { x: 0, y: 0 })).toHaveLength(0);
  });

  it('excludes an entity that materializes to nothing', () => {
    const withDead: Sketch = {
      entities: [{ kind: 'line', id: 'd', start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }],
    };
    expect(entitiesInRectMm(withDead, { x: -100, y: -100 }, { x: 100, y: 100 })).toHaveLength(0);
  });
});

// The defect the maintainer hit: clicking the MIDDLE of a shape missed it entirely,
// so the click cleared the selection and started a marquee, and shapes could never
// be moved. Interior picking is a deliberate divergence from LightBurn's
// outline-only rule (rule 3), matching Figma / Illustrator / Fusion instead.
describe('interior hit-testing on closed shapes', () => {
  const rect: SketchRectangle = {
    kind: 'rect',
    id: 'box',
    origin: { x: 0, y: 0 },
    widthMm: 100,
    heightMm: 60,
    cornerRadiusMm: 0,
  };

  it('hits the dead centre of a rectangle, far from any edge', () => {
    expect(isEntityHit(rect, { x: 50, y: 30 }, 1)).toBe(true);
  });

  it('still misses just outside it', () => {
    expect(isEntityHit(rect, { x: -5, y: 30 }, 1)).toBe(false);
    expect(isEntityHit(rect, { x: 105, y: 30 }, 1)).toBe(false);
  });

  it('hits the inside of a circle as well as its rim', () => {
    const circle: SketchCircle = {
      kind: 'circle',
      id: 'c',
      center: { x: 0, y: 0 },
      radiusMm: 20,
    };
    expect(isEntityHit(circle, { x: 0, y: 0 }, 1)).toBe(true);
    expect(isEntityHit(circle, { x: 20, y: 0 }, 1)).toBe(true);
    expect(isEntityHit(circle, { x: 30, y: 0 }, 1)).toBe(false);
  });

  it('does NOT hit the inside of an open shape, which has no inside', () => {
    const openElbow: SketchLine = {
      kind: 'line',
      id: 'l',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
    };
    expect(isEntityHit(openElbow, { x: 50, y: 40 }, 1)).toBe(false);
  });

  it('picks the topmost shape when two overlap, so clicking selects what you see', () => {
    const stacked: Sketch = { entities: [rect, { ...rect, id: 'above' }] };
    expect(hitTestSketch(stacked, { x: 50, y: 30 }, 1)?.id).toBe('above');
  });
});
