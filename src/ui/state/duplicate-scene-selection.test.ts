import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type SceneObject,
  type TextObject,
} from '../../core/scene';
import { duplicateSceneSelection } from './duplicate-scene-selection';

describe('duplicateSceneSelection', () => {
  it('copies and remaps every hop in a dependency chain', () => {
    const scene = {
      ...createProject().scene,
      objects: [guide('guide-c'), text('text-b', 'guide-c'), text('text-a', 'text-b')],
      layers: [createLayer({ id: '#000000', color: '#000000' })],
    };

    const result = duplicateSceneSelection(scene, ['text-a'], (id) => `copy-${id}`);
    const copiedRoot = result.scene.objects.find((object) => object.id === 'copy-text-a');
    const copiedMiddle = result.scene.objects.find((object) => object.id === 'copy-text-b');

    expect(copiedRoot?.kind === 'text' ? copiedRoot.pathText?.guideObjectId : undefined).toBe(
      'copy-text-b',
    );
    expect(copiedMiddle?.kind === 'text' ? copiedMiddle.pathText?.guideObjectId : undefined).toBe(
      'copy-guide-c',
    );
    expect(result.scene.objects.some((object) => object.id === 'copy-guide-c')).toBe(true);
    expect(result.selectedIds).toEqual(['copy-text-a']);
  });

  it('does not clone a partial group reached only through copied dependencies', () => {
    const objects = [guide('guide-c'), text('text-b', 'guide-c'), text('text-a', 'text-b')];
    const unrelated = guide('unrelated');
    const scene = {
      ...createProject().scene,
      objects: [...objects, unrelated],
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [
        {
          id: 'partial-group',
          name: 'Partially reached',
          objectIds: ['guide-c', 'text-b', unrelated.id],
        },
      ],
    };

    const result = duplicateSceneSelection(scene, ['text-a'], (id) => `copy-${id}`);

    expect(result.scene.groups).toEqual(scene.groups);
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

function guide(id: string): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 5, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    color: '#000000',
    paths: [],
  };
}
