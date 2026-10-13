import { describe, expect, it } from 'vitest';
import { combinedBBox } from './hit-test';
import type { SceneGroup } from './scene';
import { IDENTITY_TRANSFORM, type SceneObject, type Transform } from './scene-object';
import { buildSelectionMatchSizeEdit } from './selection-match-size';

describe('buildSelectionMatchSizeEdit', () => {
  it('matches the width about each centre and leaves the height and the reference alone', () => {
    const small = rect('small', 20, 10, { ...IDENTITY_TRANSFORM, x: 0, y: 0 });
    const reference = rect('reference', 40, 10, { ...IDENTITY_TRANSFORM, x: 100, y: 0 });

    const result = buildSelectionMatchSizeEdit([small, reference], {
      kind: 'width',
      referenceId: 'reference',
      proportional: false,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.transforms.map((entry) => entry.id)).toEqual(['small']);
    const box = boxAfter(small, result.transforms[0]?.transform);
    expect(box.maxX - box.minX).toBeCloseTo(40, 9);
    expect(box.maxY - box.minY).toBeCloseTo(10, 9);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(10, 9);
  });

  it('keeps the aspect ratio when proportional', () => {
    const square = rect('square', 40, 20, IDENTITY_TRANSFORM);
    const reference = rect('reference', 10, 99, { ...IDENTITY_TRANSFORM, x: 80 });

    const result = buildSelectionMatchSizeEdit([square, reference], {
      kind: 'width',
      referenceId: 'reference',
      proportional: true,
    });

    if (result.kind !== 'ok') throw new Error('expected ok');
    const box = boxAfter(square, result.transforms[0]?.transform);
    expect(box.maxX - box.minX).toBeCloseTo(10, 9);
    expect(box.maxY - box.minY).toBeCloseTo(5, 9);
  });

  it('resizes a group as one unit', () => {
    const a = rect('a', 10, 10, IDENTITY_TRANSFORM);
    const b = rect('b', 10, 10, { ...IDENTITY_TRANSFORM, x: 10 });
    const reference = rect('reference', 10, 40, { ...IDENTITY_TRANSFORM, x: 100 });
    const group: SceneGroup = { id: 'g', name: 'Group', objectIds: ['a', 'b'] };

    const result = buildSelectionMatchSizeEdit(
      [a, b, reference],
      { kind: 'height', referenceId: 'reference', proportional: false },
      [group],
    );

    if (result.kind !== 'ok') throw new Error('expected ok');
    const moved = [a, b].map((object) => ({
      ...object,
      transform:
        result.transforms.find((entry) => entry.id === object.id)?.transform ?? object.transform,
    }));
    const box = combinedBBox(moved);
    expect(box).not.toBeNull();
    if (box === null) return;
    expect(box.maxY - box.minY).toBeCloseTo(40, 9);
    expect(box.maxX - box.minX).toBeCloseTo(20, 9);
  });

  it('skips an obliquely rotated object that would need shear and counts it', () => {
    const turned = rect('turned', 20, 10, { ...IDENTITY_TRANSFORM, rotationDeg: 30 });
    const reference = rect('reference', 40, 10, { ...IDENTITY_TRANSFORM, x: 100 });

    const result = buildSelectionMatchSizeEdit([turned, reference], {
      kind: 'width',
      referenceId: 'reference',
      proportional: false,
    });

    expect(result).toEqual({ kind: 'ok', transforms: [], skipped: 1 });
  });

  it('needs two units and a reference inside the selection', () => {
    const only = rect('only', 10, 10, IDENTITY_TRANSFORM);
    expect(
      buildSelectionMatchSizeEdit([only], {
        kind: 'width',
        referenceId: 'only',
        proportional: false,
      }),
    ).toEqual({ kind: 'error', reason: 'not-enough-objects' });
    expect(
      buildSelectionMatchSizeEdit([only, rect('other', 5, 5, IDENTITY_TRANSFORM)], {
        kind: 'width',
        referenceId: 'missing',
        proportional: false,
      }),
    ).toEqual({ kind: 'error', reason: 'missing-reference' });
  });
});

function boxAfter(object: SceneObject, transform: Transform | undefined) {
  const box = combinedBBox([{ ...object, transform: transform ?? object.transform }]);
  if (box === null) throw new Error('no box');
  return box;
}

function rect(id: string, width: number, height: number, transform: Transform): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: width, heightMm: height, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    transform,
    paths: [],
  };
}
