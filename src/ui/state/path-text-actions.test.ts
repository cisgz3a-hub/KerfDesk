import { beforeEach, describe, expect, it } from 'vitest';
import { type TextObject } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const PATH_TEXT: TextObject = {
  kind: 'text',
  id: 'path-text',
  content: 'Curve',
  fontKey: 'roboto-regular',
  sizeMm: 10,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  pathText: { guideObjectId: 'guide', offsetMm: 4, reverse: false },
  color: '#000000',
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  transform: { x: 32, y: 48, scaleX: 1, scaleY: 1, rotationDeg: 0, mirrorX: false, mirrorY: false },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 10 },
          ],
        },
      ],
    },
  ],
};

describe('path text insertion', () => {
  beforeEach(resetStore);

  it('keeps guide-derived placement and commits in one undo step', () => {
    useStore.getState().upsertTextObject(PATH_TEXT);

    expect(useStore.getState().project.scene.objects[0]).toMatchObject({
      id: PATH_TEXT.id,
      pathText: PATH_TEXT.pathText,
      transform: { x: 32, y: 48 },
    });
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
  });
});
