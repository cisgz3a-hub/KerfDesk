import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type EmbeddedFont, type TextObject } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const FONT: EmbeddedFont = {
  key: 'embedded:studio',
  fileName: 'Studio.otf',
  dataBase64: btoa('OTTO\0\x01\x02\x03'),
};

const TEXT: TextObject = {
  kind: 'text',
  id: 'text-embedded',
  content: 'Studio',
  fontKey: FONT.key,
  sizeMm: 12,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  color: '#000000',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 5 },
          ],
        },
      ],
    },
  ],
};

describe('embedded font store actions', () => {
  beforeEach(resetStore);

  it('commits the text and font in one undo step', () => {
    useStore.getState().upsertTextObject(TEXT, FONT);

    expect(useStore.getState().project.scene.objects).toEqual([
      expect.objectContaining({ id: TEXT.id, fontKey: FONT.key, content: TEXT.content }),
    ]);
    expect(useStore.getState().project.embeddedFonts).toEqual([FONT]);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();

    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().project.embeddedFonts).toBeUndefined();
  });
});
