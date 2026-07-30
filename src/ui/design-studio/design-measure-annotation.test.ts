import { describe, expect, it } from 'vitest';
import type { SketchArc, SketchCircle, SketchLine, SketchRectangle } from '../../core/design';
import { entityFields } from './design-entity-fields';
import { annotationFor } from './design-measure-annotation';

const rect: SketchRectangle = {
  kind: 'rect',
  id: 'r',
  origin: { x: 10, y: 20 },
  widthMm: 60,
  heightMm: 40,
  cornerRadiusMm: 5,
};

const circle: SketchCircle = {
  kind: 'circle',
  id: 'c',
  center: { x: 50, y: 50 },
  radiusMm: 12,
};

const line: SketchLine = {
  kind: 'line',
  id: 'l',
  start: { x: 0, y: 0 },
  end: { x: 40, y: 0 },
};

const arc: SketchArc = {
  kind: 'arc',
  id: 'a',
  center: { x: 0, y: 0 },
  radiusMm: 20,
  startAngleDeg: 30,
  sweepDeg: 60,
};

describe('rectangle annotations', () => {
  it('spans width exactly edge to edge, below the shape', () => {
    const annotation = annotationFor(rect, 'width');
    expect(annotation?.kind).toBe('linear');
    if (annotation?.kind !== 'linear') return;
    expect(annotation.fromMm).toEqual({ x: 10, y: 60 });
    expect(annotation.toMm).toEqual({ x: 70, y: 60 });
    // Measured span equals the width the field reports.
    expect(annotation.toMm.x - annotation.fromMm.x).toBe(rect.widthMm);
    expect(annotation.offsetMm.y).toBeGreaterThan(0);
  });

  it('spans height exactly top to bottom, right of the shape', () => {
    const annotation = annotationFor(rect, 'height');
    if (annotation?.kind !== 'linear') throw new Error('expected linear');
    expect(annotation.toMm.y - annotation.fromMm.y).toBe(rect.heightMm);
    expect(annotation.offsetMm.x).toBeGreaterThan(0);
  });

  it('measures X from the work origin to the left edge', () => {
    const annotation = annotationFor(rect, 'x');
    if (annotation?.kind !== 'linear') throw new Error('expected linear');
    expect(annotation.fromMm.x).toBe(0);
    expect(annotation.toMm.x).toBe(rect.origin.x);
  });

  it('calls out the corner radius as a radial at the corner arc centre', () => {
    const annotation = annotationFor(rect, 'cornerRadius');
    if (annotation?.kind !== 'radial') throw new Error('expected radial');
    expect(annotation.centreMm).toEqual({ x: 15, y: 25 });
    const measured = Math.hypot(
      annotation.edgeMm.x - annotation.centreMm.x,
      annotation.edgeMm.y - annotation.centreMm.y,
    );
    expect(measured).toBeCloseTo(rect.cornerRadiusMm, 9);
  });

  it('has no corner-radius call-out on a sharp rectangle', () => {
    expect(annotationFor({ ...rect, cornerRadiusMm: 0 }, 'cornerRadius')).toBeNull();
  });
});

describe('circle annotations', () => {
  it('measures radius centre to rim', () => {
    const annotation = annotationFor(circle, 'radius');
    if (annotation?.kind !== 'radial') throw new Error('expected radial');
    const measured = Math.hypot(
      annotation.edgeMm.x - annotation.centreMm.x,
      annotation.edgeMm.y - annotation.centreMm.y,
    );
    expect(measured).toBeCloseTo(circle.radiusMm, 9);
  });

  it('measures diameter straight across the centre', () => {
    const annotation = annotationFor(circle, 'diameter');
    if (annotation?.kind !== 'linear') throw new Error('expected linear');
    expect(annotation.toMm.x - annotation.fromMm.x).toBeCloseTo(circle.radiusMm * 2, 9);
    expect(annotation.fromMm.y).toBe(circle.center.y);
  });
});

describe('line annotations', () => {
  it('spans the line itself for length, offset clear of it', () => {
    const annotation = annotationFor(line, 'length');
    if (annotation?.kind !== 'linear') throw new Error('expected linear');
    expect(annotation.fromMm).toEqual(line.start);
    expect(annotation.toMm).toEqual(line.end);
    // Offset must be perpendicular to the line, so it never lies along it.
    expect(annotation.offsetMm.x).toBeCloseTo(0, 9);
    expect(Math.abs(annotation.offsetMm.y)).toBeGreaterThan(0);
  });

  it('sweeps the angle from horizontal at the start point', () => {
    const diagonal: SketchLine = { ...line, end: { x: 40, y: 40 } };
    const annotation = annotationFor(diagonal, 'angle');
    if (annotation?.kind !== 'angular') throw new Error('expected angular');
    expect(annotation.centreMm).toEqual(diagonal.start);
    expect(annotation.startDeg).toBe(0);
    expect(annotation.sweepDeg).toBeCloseTo(45, 6);
  });

  it('calls out an endpoint as a point', () => {
    expect(annotationFor(line, 'endX')).toEqual({ kind: 'point', atMm: line.end });
    expect(annotationFor(line, 'startY')).toEqual({ kind: 'point', atMm: line.start });
  });
});

describe('arc annotations', () => {
  it('sweeps from the arc start by the arc sweep', () => {
    const annotation = annotationFor(arc, 'sweep');
    if (annotation?.kind !== 'angular') throw new Error('expected angular');
    expect(annotation.startDeg).toBe(30);
    expect(annotation.sweepDeg).toBe(60);
  });

  it('measures the chord between the two arc ends', () => {
    const annotation = annotationFor(arc, 'chord');
    if (annotation?.kind !== 'linear') throw new Error('expected linear');
    const measured = Math.hypot(
      annotation.toMm.x - annotation.fromMm.x,
      annotation.toMm.y - annotation.fromMm.y,
    );
    const expected = 2 * arc.radiusMm * Math.sin((60 * Math.PI) / 180 / 2);
    expect(measured).toBeCloseTo(expected, 6);
  });

  it('keeps the angle arc visible even at a tiny radius', () => {
    const annotation = annotationFor({ ...arc, radiusMm: 0.5 }, 'sweep');
    if (annotation?.kind !== 'angular') throw new Error('expected angular');
    expect(annotation.radiusMm).toBeGreaterThanOrEqual(4);
  });
});

describe('coverage', () => {
  it('annotates every editable field of every parametric shape', () => {
    for (const entity of [rect, circle, line, arc]) {
      for (const field of entityFields(entity).filter((candidate) => candidate.editable)) {
        expect(annotationFor(entity, field.key), `${entity.kind}.${field.key}`).not.toBeNull();
      }
    }
  });

  it('returns null for a path, which has no parametric dimension to call out', () => {
    expect(
      annotationFor(
        {
          kind: 'path',
          id: 'p',
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ],
          closed: false,
        },
        'width',
      ),
    ).toBeNull();
  });
});
