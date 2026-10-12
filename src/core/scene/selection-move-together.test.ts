import { describe, expect, it } from 'vitest';
import type { SceneGroup } from './scene';
import { IDENTITY_TRANSFORM, type SceneObject, type Transform } from './scene-object';
import { buildSelectionMoveTogetherEdit } from './selection-move-together';

describe('buildSelectionMoveTogetherEdit', () => {
  it('closes the gaps on both sides of the fixed reference', () => {
    const left = rect('left', 10, { ...IDENTITY_TRANSFORM, x: 0, y: 5 });
    const reference = rect('reference', 20, { ...IDENTITY_TRANSFORM, x: 50 });
    const right = rect('right', 10, { ...IDENTITY_TRANSFORM, x: 100, y: 7 });
    const far = rect('far', 5, { ...IDENTITY_TRANSFORM, x: 200 });

    const result = buildSelectionMoveTogetherEdit([left, reference, right, far], {
      axis: 'horizontal',
      referenceId: 'reference',
    });

    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.transforms).toEqual([
      { id: 'left', transform: { ...left.transform, x: 40 } },
      { id: 'right', transform: { ...right.transform, x: 70 } },
      { id: 'far', transform: { ...far.transform, x: 80 } },
    ]);
  });

  it('packs vertically and moves a group as one unit', () => {
    const a = rect('a', 10, { ...IDENTITY_TRANSFORM, y: 100 });
    const b = rect('b', 10, { ...IDENTITY_TRANSFORM, x: 30, y: 105 });
    const reference = rect('reference', 10, IDENTITY_TRANSFORM);
    const group: SceneGroup = { id: 'g', name: 'Group', objectIds: ['a', 'b'] };

    const result = buildSelectionMoveTogetherEdit(
      [a, b, reference],
      { axis: 'vertical', referenceId: 'reference' },
      [group],
    );

    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.transforms).toEqual([
      { id: 'a', transform: { ...a.transform, y: 10 } },
      { id: 'b', transform: { ...b.transform, y: 15 } },
    ]);
  });

  it('needs two units', () => {
    expect(
      buildSelectionMoveTogetherEdit([rect('only', 10, IDENTITY_TRANSFORM)], {
        axis: 'horizontal',
        referenceId: 'only',
      }),
    ).toEqual({ kind: 'error', reason: 'not-enough-objects' });
  });
});

function rect(id: string, size: number, transform: Transform): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: size, heightMm: size, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: size, maxY: size },
    transform,
    paths: [],
  };
}
