import { describe, expect, it } from 'vitest';
import type { Sketch, SketchEntity, SketchLine } from '../sketch-entity';
import { applySketchExtension, findSketchExtension } from './extend-sketch';

const source: SketchLine = {
  kind: 'line',
  id: 'source',
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
  construction: true,
  layerId: 'guide',
};
const edge = (x: number, id = 'edge'): SketchLine => ({
  kind: 'line',
  id,
  start: { x, y: -20 },
  end: { x, y: 20 },
});
const query = (boundaries: SketchEntity[], line: SketchEntity = source) =>
  findSketchExtension({ entities: [line, ...boundaries] }, source.end, 0.1);

describe('Sketch Extend geometry', () => {
  it('chooses the first forward contact and preserves source identity and metadata', () => {
    const sketch: Sketch = { entities: [source, edge(30, 'far'), edge(-10, 'behind'), edge(20)] };
    const target = findSketchExtension(sketch, source.end, 0.1)!;
    expect(target).toMatchObject({ reason: 'ready', to: { x: 20, y: 0 } });
    const result = applySketchExtension(sketch, target);
    expect(result.entities[0]).toEqual({ ...source, end: { x: 20, y: 0 } });
    expect(result.entities.slice(1)).toEqual(sketch.entities.slice(1));
    expect(sketch.entities[0]).toBe(source);
  });

  it('extends the start outward and uses nearest endpoint with topmost ties', () => {
    const sketch = { entities: [source, edge(-5)] };
    expect(findSketchExtension(sketch, source.start, 0.1)).toMatchObject({
      end: 'start',
      to: { x: -5, y: 0 },
    });
    const upper = { ...source, id: 'upper' };
    expect(findSketchExtension({ entities: [source, upper] }, source.end, 1)?.entityId).toBe(
      'upper',
    );
    expect(findSketchExtension({ entities: [source] }, { x: 5, y: 0 }, 1)).toBeNull();
  });

  it('rejects no-hit, touching, and ambiguous overlap without changing the sketch', () => {
    const parallel = { ...source, id: 'parallel', start: { x: 12, y: 2 }, end: { x: 20, y: 2 } };
    expect(query([parallel, edge(-5)])?.reason).toBe('no-boundary');
    expect(query([edge(10), edge(20)])?.reason).toBe('already-touching');
    const overlap = { ...source, id: 'overlap', start: { x: 15, y: 0 }, end: { x: 25, y: 0 } };
    expect(query([overlap, edge(30)])?.reason).toBe('overlap');
    expect(query([overlap, edge(12)])?.to).toEqual({ x: 12, y: 0 });
    const sketch = { entities: [source] };
    expect(applySketchExtension(sketch, findSketchExtension(sketch, source.end, 1)!)).toBe(sketch);
  });

  it('extends an open path terminal segment while excluding the whole source contour', () => {
    const path = {
      kind: 'path' as const,
      id: 'source',
      closed: false,
      points: [
        { x: 30, y: 10 },
        { x: 30, y: -10 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    const sketch = { entities: [path, edge(40)] };
    const target = findSketchExtension(sketch, source.end, 0.1)!;
    expect(target.to).toEqual({ x: 40, y: 0 });
    expect(applySketchExtension(sketch, target).entities[0]).toEqual({
      ...path,
      points: [...path.points.slice(0, -1), { x: 40, y: 0 }],
    });
    expect(query([], { ...path, closed: true })).toBeNull();
  });

  it('does not pick a zero-length terminal segment or a coincident closed contour', () => {
    const path = {
      kind: 'path' as const,
      id: 'path',
      closed: false,
      points: [{ x: 0, y: 0 }, source.end, source.end],
    };
    expect(query([edge(30)], path)).toBeNull();
    expect(query([], { ...path, points: [source.end, source.start, source.end] })).toBeNull();
    expect(findSketchExtension({ entities: [source] }, source.end, Infinity)).toBeNull();
  });

  it('intersects circles and ellipses analytically, including tangencies', () => {
    expect(
      query([{ kind: 'circle', id: 'circle', center: { x: 30, y: 0 }, radiusMm: 5 }])?.to?.x,
    ).toBeCloseTo(25, 10);
    expect(
      query([{ kind: 'circle', id: 'circle', center: { x: 30, y: 5 }, radiusMm: 5 }])?.to?.x,
    ).toBeCloseTo(30, 10);
    expect(
      query([
        { kind: 'ellipse', id: 'ellipse', center: { x: 30, y: 3 }, radiusXMm: 10, radiusYMm: 5 },
      ])?.to?.x,
    ).toBeCloseTo(22, 10);
  });

  it('uses only the swept arc boundary, including clockwise arcs', () => {
    const arc = {
      kind: 'arc' as const,
      id: 'arc',
      center: { x: 30, y: 0 },
      radiusMm: 5,
      startAngleDeg: -80,
      sweepDeg: 160,
    };
    expect(query([arc])?.to?.x).toBeCloseTo(35, 10);
    expect(query([{ ...arc, startAngleDeg: 80, sweepDeg: -160 }])?.to?.x).toBeCloseTo(35, 10);
    expect(query([{ ...arc, startAngleDeg: 20, sweepDeg: 40 }])?.reason).toBe('no-boundary');
  });

  it('does not change a curved source and explains why', () => {
    const arc = {
      kind: 'arc' as const,
      id: 'arc',
      center: { x: 0, y: 0 },
      radiusMm: 10,
      startAngleDeg: 0,
      sweepDeg: 90,
    };
    expect(query([edge(20)], arc)?.reason).toBe('curved-source');
    expect(query([], { ...arc, sweepDeg: 360 })).toBeNull();
  });

  it('contacts rounded rectangles on their exact corner arcs, not the bounding box', () => {
    const rect = {
      kind: 'rect' as const,
      id: 'rect',
      origin: { x: 20, y: -1 },
      widthMm: 20,
      heightMm: 20,
      cornerRadiusMm: 5,
    };
    expect(query([rect])?.to?.x).toBeCloseTo(22, 10);
    expect(query([{ ...rect, cornerRadiusMm: 0 }])?.to).toEqual({ x: 20, y: 0 });
  });

  it('does not invent an intersection with a curved boundary just out of reach', () => {
    const circle = {
      kind: 'circle' as const,
      id: 'circle',
      center: { x: 30, y: 5.0001 },
      radiusMm: 5,
    };
    expect(query([circle])?.reason).toBe('no-boundary');
  });
});
