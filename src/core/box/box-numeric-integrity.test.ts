import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deriveBoxDims, validateBoxSpec, type BoxSpec } from './box-spec';
import { generateBox } from './generate-box';

const BASE: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

describe('BoxSpec numeric integrity', () => {
  it('rejects finite inputs whose derived dimensions overflow', () => {
    const spec = { ...BASE, thicknessMm: Number.MAX_VALUE };
    const result = validateBoxSpec(spec);

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.issues.map((issue) => issue.field)).toEqual(['width', 'depth', 'height']);
    expect(generateBox(spec).kind).toBe('invalid');
  });

  it('rejects finite spacing that cannot place the third grid column', () => {
    const spec = { ...BASE, partSpacingMm: Number.MAX_VALUE };
    const result = validateBoxSpec(spec);

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.issues.map((issue) => issue.field)).toEqual(['partSpacing']);
    expect(generateBox(spec).kind).toBe('invalid');
  });

  it.each([
    {
      name: 'cumulative horizontal layout',
      spec: {
        ...BASE,
        widthMm: 6e307,
        targetFingerWidthMm: 6e307,
        partSpacingMm: 4e307,
      },
    },
    {
      name: 'translated vertical coordinate',
      spec: {
        ...BASE,
        heightMm: 1e308,
        targetFingerWidthMm: 1e308,
      },
    },
  ])('fails closed when $name overflows', ({ spec }) => {
    expect(validateBoxSpec(spec).kind).toBe('valid');
    expect(generateBox(spec)).toEqual({
      kind: 'error',
      message: 'Box dimensions or spacing exceed the supported numeric range.',
    });
  });

  it('never generates non-finite sheet geometry from a valid finite spec', () => {
    fc.assert(
      fc.property(
        fc.record({
          widthMm: finiteDouble(10, 6e307),
          depthMm: finiteDouble(10, 6e307),
          heightMm: finiteDouble(10, 6e307),
          partSpacingMm: finiteDouble(0, 4e307),
        }),
        ({ widthMm, depthMm, heightMm, partSpacingMm }) => {
          const spec = {
            ...BASE,
            widthMm,
            depthMm,
            heightMm,
            targetFingerWidthMm: Math.max(widthMm, depthMm, heightMm),
            partSpacingMm,
          };
          const validation = validateBoxSpec(spec);
          expect(validation.kind).toBe('valid');

          expect(Object.values(deriveBoxDims(spec)).every(Number.isFinite)).toBe(true);
          const generated = generateBox(spec);
          if (generated.kind !== 'generated') return;
          expect(
            generated.panels.every(
              (panel) =>
                Number.isFinite(panel.offsetMm.x) &&
                Number.isFinite(panel.offsetMm.y) &&
                [panel.outline, ...panel.cutouts].every((ring) =>
                  ring.points.every(
                    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
                  ),
                ),
            ),
          ).toBe(true);
        },
      ),
    );
  });
});

function finiteDouble(min: number, max: number): fc.Arbitrary<number> {
  return fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
}
