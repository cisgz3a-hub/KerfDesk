import { describe, expect, it } from 'vitest';
import { arrayPlacements } from '../../core/scene/array-layout';
import { IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene/scene-object';
import { centreObjectOptions, type ArrayDialogContext } from './array-dialog-centre';
import {
  arraySpecFromForm,
  defaultArrayForm,
  withCenterField,
  withCentre,
  withSpaceBy,
  withSpread,
  type ArrayForm,
} from './array-dialog-form';

function rect(id: string, x: number, y: number): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    color: '#000000',
    paths: [],
  };
}

// A hub centred on (50, 50) and a part centred on (50, 20), straight above it.
const hub = rect('hub', 45, 45);
const part = rect('part', 45, 15);
const context: ArrayDialogContext = {
  bounds: { minX: 45, minY: 15, maxX: 55, maxY: 55 },
  selected: [hub, part],
};
const form = defaultArrayForm(context.bounds);

describe('Array dialog settings', () => {
  it('asks for exactly the old requests when left untouched', () => {
    expect(arraySpecFromForm(form, context)).toEqual({
      kind: 'grid',
      rows: 2,
      columns: 2,
      spacingX: 2,
      spacingY: 2,
    });
    expect(arraySpecFromForm({ ...form, mode: 'circular' }, context)).toEqual({
      kind: 'circular',
      count: 6,
      centerX: 50,
      centerY: 35,
      radius: 25,
      startAngleDeg: 0,
      rotateCopies: false,
    });
    expect(arraySpecFromForm({ ...form, mode: 'point-rotation' }, context)).toEqual({
      kind: 'point-rotation',
      count: 6,
      totalAngleDeg: 360,
    });
  });

  it('adds only the grid extras that are set', () => {
    const extras: ArrayForm = {
      ...form,
      spaceBy: 'centres',
      rowShift: '5',
      columnShift: '-2.5',
      reverseColumns: true,
      reverseRows: true,
      mirrorColumns: 'vertical',
      mirrorRows: 'both',
    };
    expect(arraySpecFromForm(extras, context)).toEqual({
      kind: 'grid',
      rows: 2,
      columns: 2,
      spacingX: 2,
      spacingY: 2,
      spaceBy: 'centres',
      rowShift: 5,
      columnShift: -2.5,
      reverseColumns: true,
      reverseRows: true,
      mirrorColumns: 'vertical',
      mirrorRows: 'both',
    });
  });

  it('converts the spacing when switching Space by, so the grid stays the same', () => {
    const centres = withSpaceBy(form, 'centres', context.bounds);
    expect([centres.spacingX, centres.spacingY]).toEqual(['12', '42']);
    const layout = (value: ArrayForm) =>
      arrayPlacements(context.bounds, arraySpecFromForm(value, context));
    expect(layout(centres)).toEqual(layout(form));
    const back = withSpaceBy({ ...centres, spacingX: '4' }, 'gap', context.bounds);
    expect([back.spacingX, back.spacingY]).toEqual(['0', '2']);
  });

  it('converts the angles when switching how a circle spreads, so the copies stay put', () => {
    const circle: ArrayForm = { ...form, mode: 'circular', count: '8', startAngle: '10' };
    const angles = (value: ArrayForm) =>
      arrayPlacements(context.bounds, arraySpecFromForm(value, context)).map((placement) => [
        Math.round(placement.dx * 1e6) / 1e6,
        Math.round(placement.dy * 1e6) / 1e6,
      ]);
    const toEnd = withSpread(circle, 'end', context);
    expect(toEnd.endAngle).toBe('370');
    expect(angles(toEnd)).toEqual(angles(circle));
    const toStep = withSpread(circle, 'step', context);
    expect(toStep.stepAngle).toBe('45');
    expect(angles(toStep)).toEqual(angles(circle));
    const partial = withSpread({ ...toStep, stepAngle: '20' }, 'end', context);
    expect(partial.endAngle).toBe('150');
  });

  it('centres on a selected object and keeps the rest where it is', () => {
    const circle = withCentre(
      { ...form, mode: 'circular' },
      { kind: 'object', id: 'hub' },
      context,
    );
    expect([circle.radius, circle.startAngle]).toEqual(['30', '270']);
    const spec = arraySpecFromForm(circle, context);
    expect(spec).toMatchObject({ centerX: 50, centerY: 50, centerObjectId: 'hub' });
    const partBounds = { minX: 45, minY: 15, maxX: 55, maxY: 25 };
    const [first] = arrayPlacements(partBounds, spec);
    expect(Math.abs(first?.dx ?? 1)).toBeLessThan(1e-9);
    expect(Math.abs(first?.dy ?? 1)).toBeLessThan(1e-9);
  });

  it('turns a typed centre coordinate into a custom point', () => {
    const typed = withCenterField({ ...form, mode: 'circular' }, 'x', '200', context);
    expect(typed).toMatchObject({ centre: { kind: 'point' }, centerX: '200', centerY: '35.00' });
    expect(arraySpecFromForm(typed, context)).toMatchObject({ centerX: 200, centerY: 35 });
    expect(arraySpecFromForm(typed, context)).not.toHaveProperty('centerObjectId');
  });

  it('lists centre objects top-most first, leaving out what the rest takes along', () => {
    expect(centreObjectOptions([hub])).toEqual([]);
    expect(centreObjectOptions([hub, part])).toEqual([
      { id: 'part', label: 'Rectangle at 50, 20 mm' },
      { id: 'hub', label: 'Rectangle at 50, 50 mm' },
    ]);
    const masked = {
      ...rect('photo', 0, 0),
      kind: 'raster-image',
      source: 'photo.png',
      imageMaskId: 'hub',
    } as unknown as SceneObject;
    expect(centreObjectOptions([hub, masked]).map((option) => option.id)).toEqual(['photo']);
  });
});
