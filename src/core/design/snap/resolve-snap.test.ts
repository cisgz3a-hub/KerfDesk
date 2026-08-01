import { describe, expect, it } from 'vitest';
import type {
  Sketch,
  SketchArc,
  SketchCircle,
  SketchLine,
  SketchRectangle,
} from '../sketch-entity';
import { resolveSnap } from './resolve-snap';
import type { SnapKind } from './snap-kinds';

const rect: SketchRectangle = {
  kind: 'rect',
  id: 'r',
  origin: { x: 0, y: 0 },
  widthMm: 100,
  heightMm: 60,
  cornerRadiusMm: 0,
};

const circle: SketchCircle = {
  kind: 'circle',
  id: 'c',
  center: { x: 200, y: 100 },
  radiusMm: 20,
};

const only = (kind: SnapKind): ReadonlySet<SnapKind> => new Set([kind]);

describe('endpoint snapping', () => {
  const sketch: Sketch = { entities: [rect] };

  it('lands exactly on a corner from nearby', () => {
    const result = resolveSnap({ sketch, pointMm: { x: 1.5, y: 1.2 }, toleranceMm: 4 });
    expect(result?.target.kind).toBe('endpoint');
    expect(result?.target.atMm).toEqual({ x: 0, y: 0 });
  });

  it('finds all four corners', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 },
    ];
    for (const corner of corners) {
      const near = { x: corner.x + 1, y: corner.y + 1 };
      const result = resolveSnap({ sketch, pointMm: near, toleranceMm: 4 });
      expect(result?.target.atMm, JSON.stringify(corner)).toEqual(corner);
    }
  });

  it('reports nothing outside the tolerance', () => {
    expect(resolveSnap({ sketch, pointMm: { x: 40, y: -30 }, toleranceMm: 4 })).toBeNull();
  });

  it('reports nothing for a non-positive tolerance', () => {
    expect(resolveSnap({ sketch, pointMm: { x: 0, y: 0 }, toleranceMm: 0 })).toBeNull();
  });
});

describe('priority — specific beats generic', () => {
  const sketch: Sketch = { entities: [rect] };

  it('prefers the corner over the edge it sits on', () => {
    // Right on the top edge AND next to the corner: the corner must win.
    const result = resolveSnap({ sketch, pointMm: { x: 0.5, y: 0 }, toleranceMm: 4 });
    expect(result?.target.kind).toBe('endpoint');
  });

  it('prefers the edge midpoint over the edge itself', () => {
    const result = resolveSnap({ sketch, pointMm: { x: 50, y: 0.4 }, toleranceMm: 4 });
    expect(result?.target.kind).toBe('midpoint');
    expect(result?.target.atMm).toEqual({ x: 50, y: 0 });
  });

  it('falls back to the edge when no named point is near', () => {
    const result = resolveSnap({ sketch, pointMm: { x: 23, y: 0.5 }, toleranceMm: 4 });
    expect(result?.target.kind).toBe('on-line');
    expect(result?.target.atMm.y).toBeCloseTo(0, 9);
    expect(result?.target.atMm.x).toBeCloseTo(23, 9);
  });
});

describe('centre and quadrant snapping', () => {
  const sketch: Sketch = { entities: [circle] };

  it('snaps a circle centre, which is not on the drawn geometry at all', () => {
    const result = resolveSnap({ sketch, pointMm: { x: 201, y: 101 }, toleranceMm: 4 });
    expect(result?.target.kind).toBe('center');
    expect(result?.target.atMm).toEqual({ x: 200, y: 100 });
  });

  it('snaps the four compass points of the rim exactly', () => {
    const expected = [
      { x: 220, y: 100 },
      { x: 200, y: 120 },
      { x: 180, y: 100 },
      { x: 200, y: 80 },
    ];
    for (const point of expected) {
      const result = resolveSnap({
        sketch,
        pointMm: { x: point.x + 0.6, y: point.y + 0.6 },
        toleranceMm: 3,
        kinds: only('quadrant'),
      });
      expect(result?.target.atMm.x, JSON.stringify(point)).toBeCloseTo(point.x, 6);
      expect(result?.target.atMm.y, JSON.stringify(point)).toBeCloseTo(point.y, 6);
    }
  });

  it('offers the rectangle centre too', () => {
    const result = resolveSnap({
      sketch: { entities: [rect] },
      pointMm: { x: 50.5, y: 30.5 },
      toleranceMm: 4,
      kinds: only('center'),
    });
    expect(result?.target.atMm).toEqual({ x: 50, y: 30 });
  });
});

describe('arc snapping', () => {
  const quarter: SketchArc = {
    kind: 'arc',
    id: 'a',
    center: { x: 0, y: 0 },
    radiusMm: 50,
    startAngleDeg: 0,
    sweepDeg: 90,
  };
  const sketch: Sketch = { entities: [quarter] };

  it('offers both swept ends as endpoints', () => {
    const atStart = resolveSnap({ sketch, pointMm: { x: 50.5, y: 0.5 }, toleranceMm: 3 });
    expect(atStart?.target.kind).toBe('endpoint');
    const atEnd = resolveSnap({ sketch, pointMm: { x: 0.5, y: 50.5 }, toleranceMm: 3 });
    expect(atEnd?.target.kind).toBe('endpoint');
  });

  it('offers only the quadrants the arc actually sweeps through', () => {
    // 0 and 90 degrees are swept; 180 and 270 are not.
    const swept = resolveSnap({
      sketch,
      pointMm: { x: 0.4, y: 50.4 },
      toleranceMm: 3,
      kinds: only('quadrant'),
    });
    expect(swept?.target.atMm.y).toBeCloseTo(50, 6);
    const notSwept = resolveSnap({
      sketch,
      pointMm: { x: -50, y: 0 },
      toleranceMm: 3,
      kinds: only('quadrant'),
    });
    expect(notSwept).toBeNull();
  });

  it('handles a negative sweep without offering the wrong half', () => {
    const clockwise: SketchArc = { ...quarter, sweepDeg: -90 };
    const behind = resolveSnap({
      sketch: { entities: [clockwise] },
      pointMm: { x: 0, y: 50 },
      toleranceMm: 3,
      kinds: only('quadrant'),
    });
    expect(behind).toBeNull();
    const ahead = resolveSnap({
      sketch: { entities: [clockwise] },
      pointMm: { x: 0, y: -50 },
      toleranceMm: 3,
      kinds: only('quadrant'),
    });
    expect(ahead?.target.atMm.y).toBeCloseTo(-50, 6);
  });
});

describe('intersection snapping', () => {
  const cross: Sketch = {
    entities: [
      { kind: 'line', id: 'h', start: { x: 0, y: 50 }, end: { x: 100, y: 50 } },
      { kind: 'line', id: 'v', start: { x: 40, y: 0 }, end: { x: 40, y: 100 } },
    ],
  };

  it('finds where two lines cross', () => {
    const result = resolveSnap({
      sketch: cross,
      pointMm: { x: 41, y: 51 },
      toleranceMm: 4,
      kinds: only('intersection'),
    });
    expect(result?.target.atMm.x).toBeCloseTo(40, 9);
    expect(result?.target.atMm.y).toBeCloseTo(50, 9);
  });

  it('does not invent a crossing where the segments only would if extended', () => {
    const apart: Sketch = {
      entities: [
        { kind: 'line', id: 'h', start: { x: 0, y: 50 }, end: { x: 20, y: 50 } },
        { kind: 'line', id: 'v', start: { x: 40, y: 0 }, end: { x: 40, y: 100 } },
      ],
    };
    expect(
      resolveSnap({
        sketch: apart,
        pointMm: { x: 40, y: 50 },
        toleranceMm: 4,
        kinds: only('intersection'),
      }),
    ).toBeNull();
  });

  it('ignores parallel lines rather than dividing by zero', () => {
    const parallel: Sketch = {
      entities: [
        { kind: 'line', id: 'a', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
        { kind: 'line', id: 'b', start: { x: 0, y: 10 }, end: { x: 100, y: 10 } },
      ],
    };
    const result = resolveSnap({
      sketch: parallel,
      pointMm: { x: 50, y: 5 },
      toleranceMm: 20,
      kinds: only('intersection'),
    });
    expect(result).toBeNull();
  });

  it('does not report a shape crossing itself', () => {
    const selfCrossing: Sketch = {
      entities: [
        {
          kind: 'path',
          id: 'bowtie',
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
            { x: 100, y: 0 },
            { x: 0, y: 100 },
          ],
          closed: true,
        },
      ],
    };
    expect(
      resolveSnap({
        sketch: selfCrossing,
        pointMm: { x: 50, y: 50 },
        toleranceMm: 5,
        kinds: only('intersection'),
      }),
    ).toBeNull();
  });
});

describe('excluding the entity being drawn', () => {
  it('never snaps a shape to itself', () => {
    const sketch: Sketch = { entities: [rect] };
    expect(
      resolveSnap({ sketch, pointMm: { x: 0.5, y: 0.5 }, toleranceMm: 4, excludeEntityId: 'r' }),
    ).toBeNull();
  });

  it('still snaps to everything else', () => {
    const line: SketchLine = { kind: 'line', id: 'l', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const sketch: Sketch = { entities: [rect, line] };
    const result = resolveSnap({
      sketch,
      pointMm: { x: 100.5, y: 0.5 },
      toleranceMm: 4,
      excludeEntityId: 'l',
    });
    expect(result?.target.entityId).toBe('r');
  });

  // A drag moves a whole SELECTION, and every shape in it chases the cursor.
  // Excluding one id was not enough: the rest of the selection kept capturing
  // the pointer, which is what made dragging lurch.
  it('excludes every entity named in excludeEntityIds', () => {
    const line: SketchLine = { kind: 'line', id: 'l', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const sketch: Sketch = { entities: [rect, line] };
    expect(
      resolveSnap({
        sketch,
        pointMm: { x: 0.5, y: 0.5 },
        toleranceMm: 4,
        excludeEntityIds: new Set(['r', 'l']),
      }),
    ).toBeNull();
  });

  it('still snaps to a shape outside the excluded set', () => {
    const line: SketchLine = { kind: 'line', id: 'l', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const sketch: Sketch = { entities: [rect, line] };
    const result = resolveSnap({
      sketch,
      pointMm: { x: 100.5, y: 0.5 },
      toleranceMm: 4,
      excludeEntityIds: new Set(['l']),
    });
    expect(result?.target.entityId).toBe('r');
  });
});

describe('disabled kinds', () => {
  it('returns nothing when every kind is off', () => {
    expect(
      resolveSnap({
        sketch: { entities: [rect] },
        pointMm: { x: 0, y: 0 },
        toleranceMm: 4,
        kinds: new Set<SnapKind>(),
      }),
    ).toBeNull();
  });

  it('skips a corner when only centre snapping is live', () => {
    const result = resolveSnap({
      sketch: { entities: [rect] },
      pointMm: { x: 0.5, y: 0.5 },
      toleranceMm: 4,
      kinds: only('center'),
    });
    expect(result).toBeNull();
  });
});

describe('empty input', () => {
  it('returns nothing for an empty sketch', () => {
    expect(
      resolveSnap({ sketch: { entities: [] }, pointMm: { x: 0, y: 0 }, toleranceMm: 4 }),
    ).toBeNull();
  });
});
