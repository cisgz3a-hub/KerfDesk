import { describe, expect, it } from 'vitest';
import { rectFields, type RectEntity } from './design-fields-rect';

function measurements(widthMm: number, heightMm: number, cornerRadiusMm: number) {
  const rectangle: RectEntity = {
    id: 'rectangle',
    kind: 'rect',
    origin: { x: 12, y: -3 },
    widthMm,
    heightMm,
    cornerRadiusMm,
  };
  return Object.fromEntries(rectFields(rectangle).map((field) => [field.key, field.value]));
}

describe('rectangle measurements', () => {
  it('retains the ordinary rectangle area and perimeter at zero radius', () => {
    expect(measurements(40, 80, 0)).toMatchObject({ area: 3200, perimeter: 240 });
  });

  it('subtracts the four square corners outside the rounded arcs', () => {
    const result = measurements(40, 80, 5);
    expect(result.area).toBeCloseTo(3178.539816339745, 10);
    expect(result.perimeter).toBeCloseTo(231.415926535898, 10);
  });

  it.each([
    [10, 30],
    [30, 10],
  ])('clamps the radius to the shorter side of a %s by %s capsule', (width, height) => {
    const result = measurements(width, height, 100);
    // A 10 by 20 central rectangle and two radius-5 semicircles.
    expect(result.area).toBeCloseTo(200 + 25 * Math.PI, 10);
    expect(result.perimeter).toBeCloseTo(40 + 10 * Math.PI, 10);
  });

  it('reduces a fully rounded square to a circle', () => {
    const result = measurements(10, 10, 100);
    expect(result.area).toBeCloseTo(25 * Math.PI, 10);
    expect(result.perimeter).toBeCloseTo(10 * Math.PI, 10);
  });
});
