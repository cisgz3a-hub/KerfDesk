import { describe, expect, it } from 'vitest';
import type { SceneGroup } from './scene';
import { IDENTITY_TRANSFORM, type SceneObject, type Transform } from './scene-object';
import { buildSelectionAlignEdit } from './selection-align';

describe('buildSelectionAlignEdit', () => {
  it('aligns selected objects to the reference left edge and leaves the reference fixed', () => {
    const left = objectWithTransform('left', { ...IDENTITY_TRANSFORM, x: 10, y: 0 });
    const reference = objectWithTransform('reference', { ...IDENTITY_TRANSFORM, x: 40, y: 25 });

    const result = buildSelectionAlignEdit([left, reference], {
      kind: 'left',
      referenceId: 'reference',
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.transforms).toEqual([
      { id: 'left', transform: { ...left.transform, x: 40, y: 0 } },
    ]);
  });

  it('aligns centers using transformed bounds, so rotated references are handled by bbox edges', () => {
    const movable = objectWithTransform('movable', { ...IDENTITY_TRANSFORM, x: 0, y: 0 });
    const reference = objectWithTransform('reference', {
      ...IDENTITY_TRANSFORM,
      x: 50,
      y: 20,
      rotationDeg: 90,
    });

    const result = buildSelectionAlignEdit([movable, reference], {
      kind: 'center-x',
      referenceId: 'reference',
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.transforms[0]?.transform.x).toBeCloseTo(35, 6);
    expect(result.transforms[0]?.transform.y).toBe(0);
  });

  it('rejects alignment when the reference is not inside the selected objects', () => {
    const result = buildSelectionAlignEdit(
      [
        objectWithTransform('shape-a', IDENTITY_TRANSFORM),
        objectWithTransform('shape-b', { ...IDENTITY_TRANSFORM, x: 30 }),
      ],
      { kind: 'left', referenceId: 'missing' },
    );

    expect(result).toEqual({ kind: 'error', reason: 'missing-reference' });
  });

  it('aligns a group by its combined bounds and keeps its members offset from each other', () => {
    const a = objectWithTransform('a', { ...IDENTITY_TRANSFORM, x: 10, y: 0 });
    const b = objectWithTransform('b', { ...IDENTITY_TRANSFORM, x: 30, y: 20 });
    const reference = objectWithTransform('reference', { ...IDENTITY_TRANSFORM, x: 60, y: 40 });

    const result = buildSelectionAlignEdit(
      [a, b, reference],
      { kind: 'left', referenceId: 'reference' },
      [GROUP_AB],
    );

    expect(result).toEqual({
      kind: 'ok',
      transforms: [
        { id: 'a', transform: { ...a.transform, x: 60 } },
        { id: 'b', transform: { ...b.transform, x: 80 } },
      ],
    });
  });

  it('aligns to the whole group that holds the reference object', () => {
    const other = objectWithTransform('other', { ...IDENTITY_TRANSFORM, x: 100, y: 40 });
    const a = objectWithTransform('a', { ...IDENTITY_TRANSFORM, x: 10, y: 0 });
    const b = objectWithTransform('b', { ...IDENTITY_TRANSFORM, x: 30, y: 20 });

    const result = buildSelectionAlignEdit([other, a, b], { kind: 'right', referenceId: 'b' }, [
      GROUP_AB,
    ]);

    // The group spans x 10..50, so only the other object moves, to end at 50.
    expect(result).toEqual({
      kind: 'ok',
      transforms: [{ id: 'other', transform: { ...other.transform, x: 30 } }],
    });
  });

  it('treats a lone group as one object, so there is nothing to align', () => {
    const result = buildSelectionAlignEdit(
      [
        objectWithTransform('a', { ...IDENTITY_TRANSFORM, x: 10, y: 0 }),
        objectWithTransform('b', { ...IDENTITY_TRANSFORM, x: 30, y: 20 }),
      ],
      { kind: 'left', referenceId: 'b' },
      [GROUP_AB],
    );

    expect(result).toEqual({ kind: 'error', reason: 'not-enough-objects' });
  });
});

const GROUP_AB: SceneGroup = { id: 'group', name: 'Group 1', objectIds: ['a', 'b'] };

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
