import { describe, expect, it } from 'vitest';
import type {
  Sketch,
  SketchArc,
  SketchCircle,
  SketchLine,
  SketchPath,
  SketchRectangle,
} from '../sketch-entity';
import { applySketchTrim, findSketchTrim } from './trim-sketch';

const horizontal: SketchLine = {
  kind: 'line',
  id: 'h',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
};
const cutAt = (x: number, id = `v${x}`): SketchLine => ({
  kind: 'line',
  id,
  start: { x, y: -10 },
  end: { x, y: 10 },
});

function points(trimmed: Sketch, id: string): unknown {
  const entity = trimmed.entities.find((candidate) => candidate.id === id);
  if (entity?.kind === 'line') return [entity.start, entity.end];
  if (entity?.kind === 'path') return entity.points;
  return entity;
}

describe('trimming a line', () => {
  it('removes the middle piece between two cutting edges, leaving two lines', () => {
    const sketch: Sketch = { entities: [horizontal, cutAt(30), cutAt(70)] };
    const trim = findSketchTrim(sketch, { x: 50, y: 0.2 }, 1);
    expect(trim?.reason).toBe('ready');
    const trimmed = applySketchTrim(sketch, trim!, 'h2');
    expect(points(trimmed, 'h')).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ]);
    expect(points(trimmed, 'h2')).toEqual([
      { x: 70, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(trimmed.entities.map((entity) => entity.id)).toEqual(['h', 'h2', 'v30', 'v70']);
  });

  it('cuts an end piece back to the one crossing beside it', () => {
    const sketch: Sketch = { entities: [horizontal, cutAt(30)] };
    const trimmed = applySketchTrim(sketch, findSketchTrim(sketch, { x: 80, y: 0 }, 1)!, 'unused');
    expect(points(trimmed, 'h')).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ]);
    expect(trimmed.entities).toHaveLength(2);
  });

  it('reports a piece with no crossing instead of deleting it', () => {
    const sketch: Sketch = { entities: [horizontal] };
    const trim = findSketchTrim(sketch, { x: 50, y: 0 }, 1);
    expect(trim?.reason).toBe('no-boundary');
    expect(applySketchTrim(sketch, trim!, 'x')).toBe(sketch);
  });

  it('cuts at a circle crossing exactly', () => {
    const circle: SketchCircle = { kind: 'circle', id: 'c', center: { x: 50, y: 0 }, radiusMm: 10 };
    const sketch: Sketch = { entities: [horizontal, circle] };
    const trimmed = applySketchTrim(sketch, findSketchTrim(sketch, { x: 50, y: 0 }, 1)!, 'h2');
    expect(points(trimmed, 'h')).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ]);
    expect(points(trimmed, 'h2')).toEqual([
      { x: 60, y: 0 },
      { x: 100, y: 0 },
    ]);
  });
});

describe('trimming outlines', () => {
  it('opens a square-cornered rectangle into a path that skips the trimmed piece', () => {
    const rect: SketchRectangle = {
      kind: 'rect',
      id: 'r',
      origin: { x: 0, y: 0 },
      widthMm: 100,
      heightMm: 40,
      cornerRadiusMm: 0,
    };
    const sketch: Sketch = { entities: [rect, cutAt(30), cutAt(70)] };
    const trimmed = applySketchTrim(sketch, findSketchTrim(sketch, { x: 50, y: 0 }, 1)!, 'x');
    const path = trimmed.entities[0] as SketchPath;
    expect(path.kind).toBe('path');
    expect(path.closed).toBe(false);
    expect(path.points).toEqual([
      { x: 70, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 0, y: 40 },
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('turns a circle into the arc that remains, and an arc into its pieces', () => {
    const circle: SketchCircle = { kind: 'circle', id: 'c', center: { x: 0, y: 0 }, radiusMm: 10 };
    const across = cutAt(0, 'v');
    const sketch: Sketch = { entities: [circle, across] };
    const trimmed = applySketchTrim(sketch, findSketchTrim(sketch, { x: 10, y: 0 }, 1)!, 'x');
    const arc = trimmed.entities[0] as SketchArc;
    expect(arc.kind).toBe('arc');
    expect(arc.startAngleDeg).toBeCloseTo(90, 9);
    expect(arc.sweepDeg).toBeCloseTo(180, 9);

    const half: SketchArc = {
      kind: 'arc',
      id: 'a',
      center: { x: 0, y: 0 },
      radiusMm: 10,
      startAngleDeg: 0,
      sweepDeg: 180,
    };
    const split = { entities: [half, across] };
    const ends = applySketchTrim(split, findSketchTrim(split, { x: 10, y: 0.5 }, 1)!, 'a2');
    const kept = ends.entities[0] as SketchArc;
    expect(kept.startAngleDeg).toBeCloseTo(90, 9);
    expect(kept.sweepDeg).toBeCloseTo(90, 9);
  });

  it('leaves an ellipse alone and says why', () => {
    const sketch: Sketch = {
      entities: [
        { kind: 'ellipse', id: 'e', center: { x: 0, y: 0 }, radiusXMm: 20, radiusYMm: 10 },
        cutAt(0),
      ],
    };
    expect(findSketchTrim(sketch, { x: 20, y: 0 }, 1)?.reason).toBe('unsupported');
  });

  it('keeps the layer and construction flag on every piece', () => {
    const layered: SketchLine = { ...horizontal, layerId: 'deep', construction: true };
    const sketch: Sketch = { entities: [layered, cutAt(30), cutAt(70)] };
    const trimmed = applySketchTrim(sketch, findSketchTrim(sketch, { x: 50, y: 0 }, 1)!, 'h2');
    expect(trimmed.entities[1]).toMatchObject({ id: 'h2', layerId: 'deep', construction: true });
  });
});
