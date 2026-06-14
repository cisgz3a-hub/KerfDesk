import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject, type Transform } from './scene-object';
import { applyTransform } from './transform';
import { buildSelectionTransformEdit, selectionMetrics } from './selection-transform';

describe('selectionMetrics', () => {
  it('reports the combined transformed bounds for a selection', () => {
    const metrics = selectionMetrics([
      objectWithTransform('a', { ...IDENTITY_TRANSFORM, x: 10, y: 20 }),
      objectWithTransform('b', { ...IDENTITY_TRANSFORM, x: 40, y: 50 }),
    ]);

    expect(metrics).toMatchObject({
      bbox: { minX: 10, minY: 20, maxX: 60, maxY: 60 },
      width: 50,
      height: 40,
      rotationDeg: null,
      count: 2,
    });
  });
});

describe('buildSelectionTransformEdit', () => {
  it('moves every selected object so the selected anchor reaches an exact position', () => {
    const a = objectWithTransform('a', { ...IDENTITY_TRANSFORM, x: 10, y: 20 });
    const b = objectWithTransform('b', { ...IDENTITY_TRANSFORM, x: 40, y: 50 });

    const result = buildSelectionTransformEdit([a, b], {
      kind: 'position',
      anchor: 'nw',
      x: 100,
      y: 200,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.transforms).toEqual([
      { id: 'a', transform: { ...a.transform, x: 100, y: 200 } },
      { id: 'b', transform: { ...b.transform, x: 130, y: 230 } },
    ]);
  });

  it('uniformly resizes a rotated selection around its center without drifting the center', () => {
    const object = objectWithTransform('shape', {
      ...IDENTITY_TRANSFORM,
      x: 40,
      y: 25,
      rotationDeg: 30,
    });
    const beforeCenter = transformedCenter(object);

    const result = buildSelectionTransformEdit([object], {
      kind: 'resize',
      anchor: 'c',
      width: 2 * (selectionMetrics([object])?.width ?? 0),
      preserveAspect: true,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const next = { ...object, transform: result.transforms[0]?.transform ?? object.transform };
    const afterCenter = transformedCenter(next);
    const nextMetrics = selectionMetrics([next]);
    expect(afterCenter.x).toBeCloseTo(beforeCenter.x, 6);
    expect(afterCenter.y).toBeCloseTo(beforeCenter.y, 6);
    expect(nextMetrics?.width).toBeCloseTo(2 * (selectionMetrics([object])?.width ?? 0), 6);
    expect(nextMetrics?.height).toBeCloseTo(2 * (selectionMetrics([object])?.height ?? 0), 6);
  });

  it('rejects non-uniform resize for a rotated selection instead of inventing shear', () => {
    const object = objectWithTransform('shape', {
      ...IDENTITY_TRANSFORM,
      x: 40,
      y: 25,
      rotationDeg: 30,
    });

    const result = buildSelectionTransformEdit([object], {
      kind: 'resize',
      anchor: 'c',
      width: 100,
      height: 20,
      preserveAspect: false,
    });

    expect(result).toEqual({ kind: 'error', reason: 'non-uniform-rotated-selection' });
  });

  it('rotates one object around the selected anchor without moving that anchor', () => {
    const object = objectWithTransform('shape', { ...IDENTITY_TRANSFORM, x: 40, y: 25 });
    const beforeCenter = transformedCenter(object);

    const result = buildSelectionTransformEdit([object], {
      kind: 'rotate',
      anchor: 'c',
      rotationDeg: 90,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const next = { ...object, transform: result.transforms[0]?.transform ?? object.transform };
    const afterCenter = transformedCenter(next);
    expect(next.transform.rotationDeg).toBe(90);
    expect(afterCenter.x).toBeCloseTo(beforeCenter.x, 6);
    expect(afterCenter.y).toBeCloseTo(beforeCenter.y, 6);
  });
});

function objectWithTransform(id: string, transform: Transform): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform,
    paths: [],
  };
}

function transformedCenter(object: SceneObject): { readonly x: number; readonly y: number } {
  return applyTransform({ x: 10, y: 5 }, object.transform);
}
