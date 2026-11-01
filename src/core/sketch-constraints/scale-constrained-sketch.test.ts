import { describe, expect, it } from 'vitest';
import { applyTransform, IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
import type { ConstrainedSketch2d } from './constrained-sketch';
import { defaultConstrainedSketch } from './default-constrained-sketch';
import { materializeConstrainedSketch } from './materialize-constrained-sketch';
import { editableConstrainedSketch, scaleConstrainedSketch } from './scale-constrained-sketch';
import { resolveSketchParameters } from './sketch-parameters';

function worldPoints(sketch: ConstrainedSketch2d, scale: number) {
  const built = materializeConstrainedSketch(sketch, '#000000');
  if (built.paths === undefined) throw new Error('The sketch did not solve');
  const transform = { ...IDENTITY_TRANSFORM, x: 10, y: 20, scaleX: scale, scaleY: scale };
  return built.paths.flatMap((path) =>
    path.polylines.flatMap((polyline) =>
      polyline.points.map((point) => applyTransform(point, transform)),
    ),
  );
}

function sketchObject(scaleX: number, scaleY: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'sketch',
    source: 'Constrained sketch',
    transform: { ...IDENTITY_TRANSFORM, scaleX, scaleY },
    bounds: { minX: 0, minY: 0, maxX: 60, maxY: 30 },
    paths: [],
    constrainedSketch: defaultConstrainedSketch(),
  };
}

describe('an even canvas resize folded into a constrained sketch (ADR-573 Amendment 1)', () => {
  it('scales every length and leaves the expressions that only name lengths alone', () => {
    const scaled = scaleConstrainedSketch(defaultConstrainedSketch(), 2);
    expect(scaled.parameters.map((parameter) => [parameter.name, parameter.value])).toEqual([
      ['width', 120],
      ['height', 60],
      ['hole_diameter', 8],
      ['hole_x1', 'width/4'],
      ['hole_x2', '3*width/4'],
      ['hole_y', 'height/2'],
    ]);
    expect(scaled.circles.map((circle) => circle.radiusMm)).toEqual([4, 4]);
  });

  it('burns the same outline at scale 1 as the original did at the resize', () => {
    const original = worldPoints(defaultConstrainedSketch(), 1.5);
    const folded = worldPoints(scaleConstrainedSketch(defaultConstrainedSketch(), 1.5), 1);
    expect(folded).toHaveLength(original.length);
    folded.forEach((point, index) => {
      expect(point.x).toBeCloseTo(original[index]?.x ?? NaN, 5);
      expect(point.y).toBeCloseTo(original[index]?.y ?? NaN, 5);
    });
  });

  it('scales mm literals inside expressions and keeps angles, ratios and spacing', () => {
    const sketch: ConstrainedSketch2d = {
      ...defaultConstrainedSketch(),
      parameters: [
        { name: 'w', unit: 'mm', value: 60 },
        { name: 'inset', unit: 'mm', value: 'w/4 + 5 mm' },
        { name: 'packed', unit: 'mm', value: '(2.5mm+w)*2' },
        { name: 'ratio', unit: 'scalar', value: '10 mm / w' },
        { name: 'turn', unit: 'deg', value: '30 deg' },
        { name: 'count', unit: 'scalar', value: 3 },
      ],
    };
    const scaled = scaleConstrainedSketch(sketch, 2);
    expect(scaled.parameters.map((parameter) => parameter.value)).toEqual([
      120,
      'w/4 + 10 mm',
      '(5mm+w)*2',
      '20 mm / w',
      '30 deg',
      3,
    ]);
    const before = resolveSketchParameters(sketch.parameters);
    const after = resolveSketchParameters(scaled.parameters);
    if (before.kind !== 'ok' || after.kind !== 'ok') throw new Error('Parameters did not resolve');
    expect(after.values.get('inset')?.value).toBe(2 * (before.values.get('inset')?.value ?? 0));
    expect(after.values.get('packed')?.value).toBe(2 * (before.values.get('packed')?.value ?? 0));
    expect(after.values.get('ratio')?.value).toBe(before.values.get('ratio')?.value);
    expect(after.values.get('turn')?.value).toBe(30);
  });

  it('opens an editor on the sizes that burn only for an even resize', () => {
    const unit = sketchObject(1, 1);
    expect(editableConstrainedSketch(unit)).toBe(unit.constrainedSketch);
    const width = editableConstrainedSketch(sketchObject(-2, 2))?.parameters[0];
    expect(width).toEqual({ name: 'width', unit: 'mm', value: 120 });
    const stretched = sketchObject(2, 1);
    expect(editableConstrainedSketch(stretched)).toBe(stretched.constrainedSketch);
  });
});
