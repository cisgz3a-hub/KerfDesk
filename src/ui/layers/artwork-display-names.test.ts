import { describe, expect, it } from 'vitest';
import { REGISTRATION_LAYER_ID, type SceneObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { artworkDisplayNames, REGISTRATION_JIG_NAME } from './artwork-display-names';

function artwork(id: string, name: string): SceneObject {
  return {
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    }),
    name,
  };
}

describe('shared artwork display names', () => {
  it.each([
    ['Rectangle', 'Rectangle', 'Rectangle (1)'],
    ['Rectangle (1)', 'Rectangle', 'Rectangle'],
  ])('reserves natural names before numbering duplicate artwork: %j', (...names) => {
    const objects = names.map((name, index) => artwork(String(index), name));
    const labels = artworkDisplayNames(objects);
    expect(new Set(labels.values()).size).toBe(objects.length);
    objects.forEach((object) => {
      if (object.name === 'Rectangle (1)') expect(labels.get(object.id)).toBe(object.name);
    });
  });

  it('keeps the registration jig named apart from artwork of the same shape', () => {
    const jig: SceneObject = {
      ...createRectangle({
        id: 'jig',
        color: '#000000',
        spec: { widthMm: 50, heightMm: 50, cornerRadiusMm: 0 },
      }),
      operationIds: [REGISTRATION_LAYER_ID],
    };
    const plain = createRectangle({
      id: 'plain',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
    const labels = artworkDisplayNames([jig, plain, artwork('alias', REGISTRATION_JIG_NAME)]);
    expect(labels.get('jig')).toBe(REGISTRATION_JIG_NAME);
    expect(labels.get('plain')).toBe('Rectangle');
    expect(labels.get('alias')).toBe(`${REGISTRATION_JIG_NAME} (1)`);
  });

  it('avoids collisions with nested suffixes and duplicate natural aliases', () => {
    const objects = [
      'Rectangle',
      'Rectangle',
      'Rectangle (1)',
      'Rectangle (1)',
      'Rectangle (1) (1)',
    ].map((name, index) => artwork(String(index), name));
    const labels = artworkDisplayNames(objects);
    expect(new Set(labels.values()).size).toBe(objects.length);
    expect(labels.get('4')).toBe('Rectangle (1) (1)');
  });
});
