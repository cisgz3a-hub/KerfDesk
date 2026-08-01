import { describe, expect, it } from 'vitest';
import type {
  SketchArc,
  SketchCircle,
  SketchLine,
  SketchPath,
  SketchRectangle,
} from '../../core/design';
import { applyEntityField } from './design-entity-edit';
import { entityFields, fieldByKey } from './design-entity-fields';

const rect: SketchRectangle = {
  kind: 'rect',
  id: 'r',
  origin: { x: 10, y: 20 },
  widthMm: 60,
  heightMm: 40,
  cornerRadiusMm: 0,
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
  end: { x: 30, y: 40 },
};

const arc: SketchArc = {
  kind: 'arc',
  id: 'a',
  center: { x: 0, y: 0 },
  radiusMm: 20,
  startAngleDeg: 0,
  sweepDeg: 90,
};

describe('rectangle edits', () => {
  it('moves without resizing', () => {
    const moved = applyEntityField(rect, 'x', 100) as SketchRectangle;
    expect(moved.origin).toEqual({ x: 100, y: 20 });
    expect(moved.widthMm).toBe(60);
  });

  it('resizes from the origin, leaving X and Y alone', () => {
    const wider = applyEntityField(rect, 'width', 200) as SketchRectangle;
    expect(wider.widthMm).toBe(200);
    expect(wider.origin).toEqual({ x: 10, y: 20 });
  });

  it('clamps a corner radius to half the shorter side', () => {
    const rounded = applyEntityField(rect, 'cornerRadius', 999) as SketchRectangle;
    expect(rounded.cornerRadiusMm).toBe(20);
  });

  it('ignores a key that does not belong to a rectangle', () => {
    expect(applyEntityField(rect, 'radius', 5)).toBeNull();
    expect(applyEntityField(rect, 'sweep', 90)).toBeNull();
  });

  it('ignores a non-finite value', () => {
    expect(applyEntityField(rect, 'width', Number.NaN)).toBeNull();
  });

  it('ignores a width that would make the shape degenerate', () => {
    expect(applyEntityField(rect, 'width', 0)).toBeNull();
  });
});

describe('circle edits', () => {
  it('sets radius directly', () => {
    expect((applyEntityField(circle, 'radius', 30) as SketchCircle).radiusMm).toBe(30);
  });

  it('treats diameter as radius doubled', () => {
    expect((applyEntityField(circle, 'diameter', 30) as SketchCircle).radiusMm).toBe(15);
  });

  it('round-trips diameter through the field list', () => {
    const edited = applyEntityField(circle, 'diameter', 50);
    expect(edited).not.toBeNull();
    expect(fieldByKey(edited as SketchCircle, 'diameter')?.value).toBeCloseTo(50, 9);
  });
});

describe('line edits', () => {
  it('sets length along the existing direction, keeping the start put', () => {
    // The 3-4-5 line is 50 long; doubling it must keep the same heading.
    const longer = applyEntityField(line, 'length', 100) as SketchLine;
    expect(longer.start).toEqual({ x: 0, y: 0 });
    expect(longer.end.x).toBeCloseTo(60, 6);
    expect(longer.end.y).toBeCloseTo(80, 6);
  });

  it('rotates about the start when angle is typed, preserving length', () => {
    const rotated = applyEntityField(line, 'angle', 0) as SketchLine;
    expect(rotated.end.x).toBeCloseTo(50, 6);
    expect(rotated.end.y).toBeCloseTo(0, 6);
  });

  it('moves one endpoint without touching the other', () => {
    const moved = applyEntityField(line, 'endX', 99) as SketchLine;
    expect(moved.end).toEqual({ x: 99, y: 40 });
    expect(moved.start).toEqual({ x: 0, y: 0 });
  });

  it('reports length and angle consistently after an edit', () => {
    const edited = applyEntityField(line, 'angle', 90) as SketchLine;
    expect(fieldByKey(edited, 'length')?.value).toBeCloseTo(50, 6);
    expect(fieldByKey(edited, 'angle')?.value).toBeCloseTo(90, 6);
  });
});

describe('arc edits', () => {
  it('solves radius from a typed arc length at the current sweep', () => {
    // 90 degrees at r = 20 is 31.4159 long; asking for 40 must grow the radius.
    const edited = applyEntityField(arc, 'arcLength', 40) as SketchArc;
    expect(edited.radiusMm).toBeCloseTo(40 / (Math.PI / 2), 6);
    expect(fieldByKey(edited, 'arcLength')?.value).toBeCloseTo(40, 6);
  });

  it('refuses an arc length solve at zero sweep rather than dividing by zero', () => {
    expect(applyEntityField({ ...arc, sweepDeg: 0 }, 'arcLength', 40)).toBeNull();
  });

  it('clamps a typed sweep to one full turn', () => {
    expect((applyEntityField(arc, 'sweep', 900) as SketchArc).sweepDeg).toBe(360);
  });
});

describe('path edits', () => {
  const path: SketchPath = {
    kind: 'path',
    id: 'p',
    points: [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 25 },
    ],
    closed: true,
  };

  it('translates every point when the bounds origin is typed', () => {
    const moved = applyEntityField(path, 'x', 0) as SketchPath;
    expect(moved.points.map((point) => point.x)).toEqual([0, 20, 20]);
    expect(moved.points.map((point) => point.y)).toEqual([10, 10, 25]);
  });

  it('does not pretend width is editable', () => {
    expect(applyEntityField(path, 'width', 100)).toBeNull();
    expect(entityFields(path).find((field) => field.key === 'width')?.editable).toBe(false);
  });
});

describe('every editable field is actually editable', () => {
  it('accepts a plausible value for each editable key on each shape', () => {
    for (const entity of [rect, circle, line, arc]) {
      for (const field of entityFields(entity).filter((candidate) => candidate.editable)) {
        const probe = field.unit === 'deg' ? 30 : 25;
        expect(
          applyEntityField(entity, field.key, probe),
          `${entity.kind}.${field.key}`,
        ).not.toBeNull();
      }
    }
  });
});
