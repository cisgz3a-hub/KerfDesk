import { describe, expect, it } from 'vitest';
import {
  EMPTY_SKETCH,
  MIN_ENTITY_SIZE_MM,
  sanitizeEntity,
  type SketchArc,
  type SketchCircle,
  type SketchLine,
  type SketchPath,
  type SketchRectangle,
} from './sketch-entity';

const line = (start: { x: number; y: number }, end: { x: number; y: number }): SketchLine => ({
  kind: 'line',
  id: 'l1',
  start,
  end,
});

describe('sanitizeEntity', () => {
  it('keeps a line longer than the minimum', () => {
    expect(sanitizeEntity(line({ x: 0, y: 0 }, { x: 10, y: 0 }))).not.toBeNull();
  });

  it('drops a zero-length line — a click is not a draw', () => {
    expect(sanitizeEntity(line({ x: 4, y: 4 }, { x: 4, y: 4 }))).toBeNull();
  });

  it('drops a line shorter than MIN_ENTITY_SIZE_MM', () => {
    const tiny = MIN_ENTITY_SIZE_MM / 2;
    expect(sanitizeEntity(line({ x: 0, y: 0 }, { x: tiny, y: 0 }))).toBeNull();
  });

  it('drops non-finite coordinates', () => {
    expect(sanitizeEntity(line({ x: 0, y: 0 }, { x: Number.NaN, y: 0 }))).toBeNull();
    expect(sanitizeEntity(line({ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 0 }))).toBeNull();
  });

  it('clamps an arc sweep to one full turn while preserving direction', () => {
    const arc: SketchArc = {
      kind: 'arc',
      id: 'a1',
      center: { x: 0, y: 0 },
      radiusMm: 5,
      startAngleDeg: 0,
      sweepDeg: -900,
    };
    const clean = sanitizeEntity(arc) as SketchArc | null;
    expect(clean?.sweepDeg).toBe(-360);
  });

  it('drops an arc with a non-positive radius', () => {
    const arc: SketchArc = {
      kind: 'arc',
      id: 'a2',
      center: { x: 0, y: 0 },
      radiusMm: 0,
      startAngleDeg: 0,
      sweepDeg: 90,
    };
    expect(sanitizeEntity(arc)).toBeNull();
  });

  it('drops a circle with a non-finite radius', () => {
    const circle: SketchCircle = {
      kind: 'circle',
      id: 'c1',
      center: { x: 1, y: 2 },
      radiusMm: Number.NaN,
    };
    expect(sanitizeEntity(circle)).toBeNull();
  });

  it('clamps a rectangle corner radius to half the shorter side', () => {
    const rect: SketchRectangle = {
      kind: 'rect',
      id: 'r1',
      origin: { x: 0, y: 0 },
      widthMm: 20,
      heightMm: 10,
      cornerRadiusMm: 40,
    };
    const clean = sanitizeEntity(rect) as SketchRectangle | null;
    expect(clean?.cornerRadiusMm).toBe(5);
  });

  it('rejects a negative rectangle corner radius rather than clamping it', () => {
    const rect: SketchRectangle = {
      kind: 'rect',
      id: 'r2',
      origin: { x: 0, y: 0 },
      widthMm: 20,
      heightMm: 10,
      cornerRadiusMm: -1,
    };
    expect(sanitizeEntity(rect)).toBeNull();
  });

  it('drops non-finite points from a path and rejects one with fewer than two left', () => {
    const path: SketchPath = {
      kind: 'path',
      id: 'p1',
      points: [
        { x: 0, y: 0 },
        { x: Number.NaN, y: 1 },
        { x: 5, y: 5 },
      ],
      closed: false,
    };
    const clean = sanitizeEntity(path) as SketchPath | null;
    expect(clean?.points).toHaveLength(2);

    const degenerate: SketchPath = { ...path, points: [{ x: 0, y: 0 }] };
    expect(sanitizeEntity(degenerate)).toBeNull();
  });
});

describe('EMPTY_SKETCH', () => {
  it('starts with no entities', () => {
    expect(EMPTY_SKETCH.entities).toHaveLength(0);
  });
});
