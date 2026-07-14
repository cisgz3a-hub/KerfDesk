import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import { selectionMoveCursor } from './selection-move-cursor';

const object: SceneObject = {
  kind: 'imported-svg',
  id: 'selected',
  source: 'selected.svg',
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [],
};

describe('selectionMoveCursor', () => {
  it('shows the move cursor over an enabled center handle', () => {
    expect(
      selectionMoveCursor({
        isMoving: false,
        isEnabled: true,
        objects: [object],
        point: { x: 10, y: 5 },
        pxToMm: 0.5,
      }),
    ).toBe('move');
  });

  it('stays neutral outside select mode', () => {
    expect(
      selectionMoveCursor({
        isMoving: false,
        isEnabled: false,
        objects: [object],
        point: { x: 10, y: 5 },
        pxToMm: 0.5,
      }),
    ).toBe('');
  });
});
