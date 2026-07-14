import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import { hitSelectionMoveHandle, selectionMoveHandlePosition } from './selection-move-handle';

describe('selection move handle', () => {
  const objects = [objectAt('left', 0), objectAt('right', 30)];

  it('sits at the center of the combined selection bounds', () => {
    expect(selectionMoveHandlePosition(objects)).toEqual({ x: 20, y: 5 });
  });

  it('uses a zoom-stable screen-space hit target', () => {
    expect(hitSelectionMoveHandle(objects, { x: 21.5, y: 5 }, 0.25)).toBe(true);
    expect(hitSelectionMoveHandle(objects, { x: 22, y: 5 }, 0.25)).toBe(false);
  });
});

function objectAt(id: string, x: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x },
    paths: [],
  };
}
