import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM } from '../scene';
import { createRectangle } from './create-rectangle';
import { rematerializeParametricShape, sanitizeParametricShapeSpec } from './rematerialize-shape';

describe('rematerializeParametricShape', () => {
  it('regenerates canonical geometry while preserving placement and CAM metadata', () => {
    const original = {
      ...createRectangle({
        id: 'rect-1',
        color: '#ff0000',
        spec: { widthMm: 40, heightMm: 20, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 12, y: 8, rotationDeg: 30 },
      }),
      powerScale: 65,
      operationOverride: { mode: 'fill' as const, speed: 1200 },
    };

    const updated = rematerializeParametricShape(original, {
      kind: 'rect',
      widthMm: 40,
      heightMm: 20,
      cornerRadiusMm: 5,
    });

    expect(updated).not.toBeNull();
    expect(updated?.transform).toEqual(original.transform);
    expect(updated?.powerScale).toBe(65);
    expect(updated?.operationOverride).toEqual({ mode: 'fill', speed: 1200 });
    expect(updated?.bounds).toEqual(original.bounds);
    expect(
      updated?.paths[0]?.curves?.[0]?.segments.some((segment) => segment.kind === 'cubic'),
    ).toBe(true);
    expect(updated?.paths).not.toEqual(original.paths);
  });

  it('normalizes bounded categorical parameters and rejects invalid dimensions', () => {
    expect(
      sanitizeParametricShapeSpec({
        kind: 'star',
        points: 100,
        outerRadiusMm: 20,
        innerRadiusRatio: 0,
      }),
    ).toEqual({ kind: 'star', points: 64, outerRadiusMm: 20, innerRadiusRatio: 0.05 });
    expect(
      sanitizeParametricShapeSpec({
        kind: 'ellipse',
        widthMm: Number.NaN,
        heightMm: 20,
      }),
    ).toBeNull();
  });
});
