import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject, type Transform } from './scene-object';
import { applyTransform } from './transform';
import {
  buildSelectionNudgeEdit,
  buildSelectionTransformEdit,
  selectionMetrics,
} from './selection-transform';

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

  // Weakness audit H-7: a shape turned 90 degrees is still square to the bed,
  // so typing a new W with the aspect unlocked is a plain one-axis stretch.
  it.each([
    { rotationDeg: 90, mirrorX: false },
    { rotationDeg: 270, mirrorX: false },
    { rotationDeg: -90, mirrorX: true },
  ])(
    'stretches a shape turned $rotationDeg degrees along the bed (mirrorX $mirrorX)',
    ({ rotationDeg, mirrorX }) => {
      const object = objectWithTransform('shape', {
        ...IDENTITY_TRANSFORM,
        x: 40,
        y: 25,
        rotationDeg,
        mirrorX,
      });
      const before = selectionMetrics([object]);
      if (before === null) throw new Error('expected metrics');
      expect(before.width).toBeCloseTo(10, 9);
      expect(before.height).toBeCloseTo(20, 9);

      const result = buildSelectionTransformEdit([object], {
        kind: 'resize',
        anchor: 'nw',
        width: 30,
        preserveAspect: false,
      });

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      const next = { ...object, transform: result.transforms[0]?.transform ?? object.transform };
      const after = selectionMetrics([next]);
      expect(after?.width).toBeCloseTo(30, 9);
      expect(after?.height).toBeCloseTo(20, 9);
      expect(after?.bbox.minX).toBeCloseTo(before.bbox.minX, 9);
      expect(after?.bbox.minY).toBeCloseTo(before.bbox.minY, 9);
      // The object's own height lies along the bed's X, so it takes the stretch.
      expect(next.transform.scaleX).toBeCloseTo(1, 9);
      expect(next.transform.scaleY).toBeCloseTo(3, 9);
      expect(next.transform.rotationDeg).toBe(rotationDeg);
    },
  );

  it('stretches a selection of upright and quarter-turned shapes along the bed', () => {
    const upright = objectWithTransform('upright', { ...IDENTITY_TRANSFORM, x: 0, y: 0 });
    const turned = objectWithTransform('turned', {
      ...IDENTITY_TRANSFORM,
      x: 50,
      y: 0,
      rotationDeg: 90,
    });
    const before = selectionMetrics([upright, turned]);
    if (before === null) throw new Error('expected metrics');

    const result = buildSelectionTransformEdit([upright, turned], {
      kind: 'resize',
      anchor: 'nw',
      height: before.height * 2,
      preserveAspect: false,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const byId = new Map(result.transforms.map((entry) => [entry.id, entry.transform]));
    const moved = (object: SceneObject): SceneObject => ({
      ...object,
      transform: byId.get(object.id) ?? object.transform,
    });
    const after = selectionMetrics([moved(upright), moved(turned)]);
    expect(after?.width).toBeCloseTo(before.width, 9);
    expect(after?.height).toBeCloseTo(before.height * 2, 9);
    for (const object of [upright, turned]) {
      const was = selectionMetrics([object]);
      const now = selectionMetrics([moved(object)]);
      expect(now?.width).toBeCloseTo(was?.width ?? 0, 9);
      expect(now?.height).toBeCloseTo((was?.height ?? 0) * 2, 9);
    }
  });

  // Rotation ignores the 9-dot anchor by construction (it carries none), so the
  // centre stays pinned even when that anchor is the default 'nw'.
  it('rotates one object about its centre without moving it', () => {
    const object = objectWithTransform('shape', { ...IDENTITY_TRANSFORM, x: 40, y: 25 });
    const beforeCenter = transformedCenter(object);

    const result = buildSelectionTransformEdit([object], {
      kind: 'rotate',
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

  it('rejects non-finite numeric edits before writing transforms', () => {
    const object = objectWithTransform('shape', { ...IDENTITY_TRANSFORM, x: 40, y: 25 });

    expect(
      buildSelectionTransformEdit([object], {
        kind: 'position',
        anchor: 'nw',
        x: Number.NaN,
      }),
    ).toEqual({ kind: 'error', reason: 'invalid-number' });

    expect(
      buildSelectionTransformEdit([object], {
        kind: 'resize',
        anchor: 'c',
        width: Number.POSITIVE_INFINITY,
        preserveAspect: true,
      }),
    ).toEqual({ kind: 'error', reason: 'invalid-dimension' });

    expect(
      buildSelectionTransformEdit([object], {
        kind: 'rotate',
        rotationDeg: Number.NaN,
      }),
    ).toEqual({ kind: 'error', reason: 'invalid-number' });

    expect(buildSelectionNudgeEdit([object], Number.NaN, 0)).toEqual({
      kind: 'error',
      reason: 'invalid-number',
    });
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
