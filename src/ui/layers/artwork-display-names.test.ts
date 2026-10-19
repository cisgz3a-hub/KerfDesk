import { describe, expect, it } from 'vitest';
import { type SceneObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { artworkDisplayNames } from './artwork-display-names';

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
