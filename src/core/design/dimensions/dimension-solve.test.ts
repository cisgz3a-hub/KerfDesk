import { describe, expect, it } from 'vitest';
import type { Sketch, SketchLine, SketchPath, SketchRectangle } from '../sketch-entity';
import {
  driveDimension,
  enforceDimensions,
  inferDimension,
  measureDimension,
  setDimensionDriving,
  type SketchDimension,
} from './index';

const base: SketchLine = { kind: 'line', id: 'a', start: { x: 0, y: 0 }, end: { x: 30, y: 0 } };
const riser: SketchLine = { kind: 'line', id: 'b', start: { x: 0, y: 0 }, end: { x: 0, y: 20 } };
const rect: SketchRectangle = {
  kind: 'rect',
  id: 'r',
  origin: { x: 10, y: 10 },
  widthMm: 40,
  heightMm: 20,
  cornerRadiusMm: 0,
};
const path: SketchPath = {
  kind: 'path',
  id: 'p',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  closed: false,
};

function dim(partial: Omit<SketchDimension, 'id'>): SketchDimension {
  return { id: 'd', ...partial };
}

function entity<T>(sketch: Sketch, id: string): T {
  return sketch.entities.find((candidate) => candidate.id === id) as T;
}

describe('inferDimension', () => {
  const sketch: Sketch = { entities: [base, riser, rect, path] };

  it('waits on a line, then makes an angle from a second line or a length otherwise', () => {
    expect(inferDimension(sketch, { entityId: 'a', atMm: { x: 5, y: 0 } }, null)).toEqual({
      kind: 'pending',
      lineId: 'a',
    });
    const angle = inferDimension(sketch, { entityId: 'b', atMm: { x: 0, y: 5 } }, 'a');
    expect(angle).toMatchObject({ kind: 'dimension', dimension: { kind: 'angle', value: 90 } });
    const length = inferDimension(sketch, null, 'a');
    expect(length).toMatchObject({ dimension: { kind: 'line-length', value: 30, driving: true } });
  });

  it('reads the picked rectangle edge and polyline segment', () => {
    expect(inferDimension(sketch, { entityId: 'r', atMm: { x: 30, y: 10.2 } }, null)).toMatchObject(
      {
        dimension: { kind: 'rect-width', value: 40 },
      },
    );
    expect(inferDimension(sketch, { entityId: 'r', atMm: { x: 50, y: 20 } }, null)).toMatchObject({
      dimension: { kind: 'rect-height', value: 20 },
    });
    expect(inferDimension(sketch, { entityId: 'p', atMm: { x: 10, y: 6 } }, null)).toMatchObject({
      dimension: { kind: 'segment-length', segmentIndex: 1, value: 10 },
    });
  });

  it('offers nothing for empty space or parallel lines', () => {
    expect(inferDimension(sketch, null, null)).toEqual({ kind: 'none' });
    const parallel: SketchLine = { ...base, id: 'c', start: { x: 0, y: 5 }, end: { x: 9, y: 5 } };
    const withParallel: Sketch = { entities: [base, parallel] };
    expect(inferDimension(withParallel, { entityId: 'c', atMm: { x: 1, y: 5 } }, 'a')).toEqual({
      kind: 'none',
    });
  });
});

describe('driveDimension', () => {
  it('moves a line end along the line and records the driving value', () => {
    const sketch: Sketch = { entities: [base] };
    const driven = driveDimension(
      sketch,
      dim({ kind: 'line-length', entityId: 'a', driving: false }),
      50,
    );
    expect(entity<SketchLine>(driven!, 'a').end).toEqual({ x: 50, y: 0 });
  });

  it('carries the rest of an open polyline with a resized segment', () => {
    const sketch: Sketch = { entities: [path] };
    const driven = driveDimension(
      sketch,
      dim({ kind: 'segment-length', entityId: 'p', segmentIndex: 0, driving: true, value: 10 }),
      25,
    );
    expect(entity<SketchPath>(driven!, 'p').points).toEqual([
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 25, y: 10 },
    ]);
  });

  it('turns the second line about the intersection to the typed angle', () => {
    const sketch: Sketch = { entities: [base, riser] };
    const angle = dim({
      kind: 'angle',
      entityId: 'a',
      otherEntityId: 'b',
      driving: true,
      value: 90,
    });
    const driven = driveDimension({ ...sketch, dimensions: [angle] }, angle, 45);
    const turned = entity<SketchLine>(driven!, 'b');
    expect(turned.start).toEqual({ x: 0, y: 0 });
    expect(turned.end.x).toBeCloseTo(20 / Math.SQRT2, 9);
    expect(turned.end.y).toBeCloseTo(20 / Math.SQRT2, 9);
    expect(measureDimension(driven!, angle)).toBeCloseTo(45, 9);
    expect(driven!.dimensions?.[0]?.value).toBe(45);
  });

  it('refuses a value that leaves nothing to cut', () => {
    const sketch: Sketch = { entities: [rect] };
    expect(
      driveDimension(sketch, dim({ kind: 'rect-width', entityId: 'r', driving: true }), 0),
    ).toBeNull();
    const angle = dim({ kind: 'angle', entityId: 'a', otherEntityId: 'b', driving: true });
    expect(driveDimension({ entities: [base, riser] }, angle, 180)).toBeNull();
  });
});

describe('enforceDimensions', () => {
  it('re-imposes a driving value after an edit changed its geometry', () => {
    const width = dim({ kind: 'rect-width', entityId: 'r', driving: true, value: 40 });
    const stretched: Sketch = { entities: [{ ...rect, widthMm: 55 }], dimensions: [width] };
    expect(entity<SketchRectangle>(enforceDimensions(stretched), 'r').widthMm).toBe(40);
  });

  it('leaves a driven dimension reading the geometry and keeps identity when nothing changes', () => {
    const width = dim({ kind: 'rect-width', entityId: 'r', driving: false });
    const sketch: Sketch = { entities: [{ ...rect, widthMm: 55 }], dimensions: [width] };
    expect(enforceDimensions(sketch)).toBe(sketch);
  });

  it('drops a dimension whose geometry is gone or changed kind', () => {
    const gone = dim({ kind: 'diameter', entityId: 'missing', driving: true, value: 4 });
    const pruned = enforceDimensions({ entities: [rect], dimensions: [gone] });
    expect(pruned.dimensions).toBeUndefined();
  });

  it('switches between driving and driven at the current reading', () => {
    const width = dim({ kind: 'rect-width', entityId: 'r', driving: true, value: 40 });
    const driven = setDimensionDriving({ entities: [rect], dimensions: [width] }, 'd', false);
    expect(driven.dimensions?.[0]).toEqual({
      id: 'd',
      kind: 'rect-width',
      entityId: 'r',
      driving: false,
    });
    const back = setDimensionDriving(
      { entities: [{ ...rect, widthMm: 33 }], dimensions: driven.dimensions! },
      'd',
      true,
    );
    expect(back.dimensions?.[0]).toMatchObject({ driving: true, value: 33 });
  });
});
