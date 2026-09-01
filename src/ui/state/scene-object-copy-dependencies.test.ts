import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type TextObject } from '../../core/scene';
import {
  remapSceneObjectCopyDependencies,
  sceneObjectCopyClosure,
} from './scene-object-copy-dependencies';

describe('scene object copy dependencies', () => {
  it('terminates cycles and remaps both directions', () => {
    const a = text('a', 'b');
    const b = text('b', 'a');

    const closure = sceneObjectCopyClosure([b, a], new Set(['a']));
    const ids = new Map([
      ['a', 'copy-a'],
      ['b', 'copy-b'],
    ]);

    expect(closure.map((object) => object.id)).toEqual(['b', 'a']);
    expect(remapSceneObjectCopyDependencies(a, ids)).toMatchObject({
      pathText: { guideObjectId: 'copy-b' },
    });
    expect(remapSceneObjectCopyDependencies(b, ids)).toMatchObject({
      pathText: { guideObjectId: 'copy-a' },
    });
  });

  it('keeps a missing reference truthful without inventing an object or id', () => {
    const source = text('source', 'missing-guide');

    const closure = sceneObjectCopyClosure([source], new Set(['source']));

    expect(closure).toEqual([source]);
    expect(remapSceneObjectCopyDependencies(source, new Map([['source', 'copy-source']]))).toBe(
      source,
    );
  });
});

function text(id: string, guideObjectId: string): TextObject {
  return {
    kind: 'text',
    id,
    content: id,
    fontKey: 'Roboto',
    sizeMm: 5,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    pathText: { guideObjectId, offsetMm: 0, reverse: false },
  };
}
