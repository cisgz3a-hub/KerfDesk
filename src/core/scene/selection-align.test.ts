import { describe, expect, it } from 'vitest';
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
