import { describe, expect, it } from 'vitest';
import { entityToPolylines } from './entity-geometry';
import type {
  SketchArc,
  SketchCircle,
  SketchLine,
  SketchPath,
  SketchRectangle,
} from './sketch-entity';
import { DESIGN_SOURCE_PREFIX, designEntityToSceneObject } from './to-scene-object';

const CUT = '#000000';

const rect: SketchRectangle = {
  kind: 'rect',
  id: 'r',
  origin: { x: 30, y: 40 },
  widthMm: 60,
  heightMm: 25,
  cornerRadiusMm: 4,
};

const circle: SketchCircle = {
  kind: 'circle',
  id: 'c',
  center: { x: 100, y: 80 },
  radiusMm: 12.5,
};

const line: SketchLine = {
  kind: 'line',
  id: 'l',
  start: { x: 5, y: 5 },
  end: { x: 45, y: 25 },
};

describe('rectangle becomes a parametric shape', () => {
  const object = designEntityToSceneObject(rect, 'new-r', CUT);

  it('is a kind:shape rect, so the main canvas can still edit it', () => {
    expect(object?.kind).toBe('shape');
    if (object?.kind !== 'shape') return;
    expect(object.spec.kind).toBe('rect');
  });

  it('keeps the exact dimensions and corner radius in the spec', () => {
    if (object?.kind !== 'shape' || object.spec.kind !== 'rect') throw new Error('expected rect');
    expect(object.spec.widthMm).toBe(60);
    expect(object.spec.heightMm).toBe(25);
    expect(object.spec.cornerRadiusMm).toBe(4);
  });

  it('places the sketch origin through the transform, not the geometry', () => {
    if (object?.kind !== 'shape') throw new Error('expected shape');
    expect(object.transform.x).toBe(30);
    expect(object.transform.y).toBe(40);
    // Geometry stays in local space with its minimum corner at the origin.
    expect(object.bounds).toEqual({ minX: 0, minY: 0, maxX: 60, maxY: 25 });
  });

  it('lands on the given id and colour', () => {
    expect(object?.id).toBe('new-r');
    if (object?.kind !== 'shape') return;
    expect(object.color).toBe(CUT);
  });
});

describe('circle becomes a parametric ellipse', () => {
  const object = designEntityToSceneObject(circle, 'new-c', CUT);

  it('uses equal axes at the diameter', () => {
    if (object?.kind !== 'shape' || object.spec.kind !== 'ellipse') {
      throw new Error('expected ellipse');
    }
    expect(object.spec.widthMm).toBe(25);
    expect(object.spec.heightMm).toBe(25);
  });

  it('offsets the transform by the radius, since an ellipse is top-left placed', () => {
    if (object?.kind !== 'shape') throw new Error('expected shape');
    expect(object.transform.x).toBe(100 - 12.5);
    expect(object.transform.y).toBe(80 - 12.5);
  });
});

describe('line, arc and path bake to exact geometry', () => {
  it('carries a line as world-space polylines under an identity transform', () => {
    const object = designEntityToSceneObject(line, 'new-l', CUT);
    expect(object?.kind).toBe('imported-svg');
    if (object?.kind !== 'imported-svg') return;
    expect(object.transform.x).toBe(0);
    expect(object.transform.y).toBe(0);
    expect(object.paths[0]?.polylines[0]?.points).toEqual([
      { x: 5, y: 5 },
      { x: 45, y: 25 },
    ]);
    expect(object.bounds).toEqual({ minX: 5, minY: 5, maxX: 45, maxY: 25 });
  });

  it('bakes an arc to the SAME points the canvas drew — no re-fairing', () => {
    const arc: SketchArc = {
      kind: 'arc',
      id: 'a',
      center: { x: 0, y: 0 },
      radiusMm: 20,
      startAngleDeg: 0,
      sweepDeg: 90,
    };
    const object = designEntityToSceneObject(arc, 'new-a', CUT);
    if (object?.kind !== 'imported-svg') throw new Error('expected imported-svg');
    // Byte-for-byte the canvas geometry: a precise arc must not be re-fitted.
    expect(object.paths[0]?.polylines).toEqual(entityToPolylines(arc));
    for (const point of object.paths[0]?.polylines[0]?.points ?? []) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(20, 6);
    }
  });

  it('preserves a closed path as closed', () => {
    const path: SketchPath = {
      kind: 'path',
      id: 'p',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      closed: true,
    };
    const object = designEntityToSceneObject(path, 'new-p', CUT);
    if (object?.kind !== 'imported-svg') throw new Error('expected imported-svg');
    expect(object.paths[0]?.polylines[0]?.closed).toBe(true);
  });

  it('marks the source as generated so re-import cannot match it', () => {
    const object = designEntityToSceneObject(line, 'new-l', CUT);
    if (object?.kind !== 'imported-svg') return;
    expect(object.source.startsWith(DESIGN_SOURCE_PREFIX)).toBe(true);
  });
});

describe('what is deliberately excluded', () => {
  it('never emits construction geometry', () => {
    expect(designEntityToSceneObject({ ...rect, construction: true }, 'x', CUT)).toBeNull();
    expect(designEntityToSceneObject({ ...circle, construction: true }, 'x', CUT)).toBeNull();
    expect(designEntityToSceneObject({ ...line, construction: true }, 'x', CUT)).toBeNull();
  });

  it('drops a degenerate entity rather than adding an empty object', () => {
    expect(designEntityToSceneObject({ ...rect, widthMm: 0 }, 'x', CUT)).toBeNull();
    expect(designEntityToSceneObject({ ...circle, radiusMm: 0 }, 'x', CUT)).toBeNull();
    expect(designEntityToSceneObject({ ...line, end: { x: 5, y: 5 } }, 'x', CUT)).toBeNull();
  });
});

describe('determinism', () => {
  it('produces identical objects for identical input', () => {
    expect(designEntityToSceneObject(rect, 'same', CUT)).toEqual(
      designEntityToSceneObject(rect, 'same', CUT),
    );
  });
});
