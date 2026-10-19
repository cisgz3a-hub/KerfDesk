import { describe, expect, it } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type Scene, type SceneObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { registrationJigCopyId } from '../../core/scene/registration-jig-artwork';
import { selectedArtworkLightTargets } from './selected-artwork-light-targets';

function artwork(id: string, x = 0): SceneObject {
  return {
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
    }),
    name: id,
    transform: { ...IDENTITY_TRANSFORM, x },
  };
}
function scene(objects: ReadonlyArray<SceneObject>, groups: Scene['groups'] = []): Scene {
  return { objects, groups, layers: [] };
}

describe('individual artwork light choices', () => {
  it('offers selected artwork individually with dimensions, excluding stale IDs', () => {
    const targets = selectedArtworkLightTargets(scene([artwork('logo'), artwork('name')]), [
      'logo',
      'name',
      'missing',
    ]);
    expect(targets.map((target) => target.objectIds)).toEqual([['logo'], ['name']]);
    expect(targets[0]?.label).toBe('logo · 20 × 10 mm');
  });

  it('does not offer registration outlines or hidden selected artwork', () => {
    const project: Scene = {
      ...scene([
        artwork('visible'),
        { ...artwork('hidden'), operationIds: ['hidden-operation'] },
        { ...artwork('jig'), operationIds: ['registration'] },
      ]),
      layers: [{ ...createLayer({ id: 'hidden-operation', color: '#123456' }), visible: false }],
    };
    expect(
      selectedArtworkLightTargets(project, ['visible', 'hidden', 'jig']).map(
        (target) => target.objectIds,
      ),
    ).toEqual([['visible']]);
  });

  it('uses the selected group as a unit and its outer group name', () => {
    const project = scene(
      [artwork('a'), artwork('b', 30), artwork('c', 80)],
      [
        { id: 'outer', name: 'Whole logo', objectIds: ['a', 'b'] },
        { id: 'inner', name: 'Detail', objectIds: ['a'], parentId: 'outer' },
      ],
    );
    const targets = selectedArtworkLightTargets(project, ['a', 'b', 'c']);
    expect(targets.map((target) => target.objectIds)).toEqual([['a', 'b'], ['c']]);
    expect(targets[0]?.label).toBe('Whole logo · 50 × 10 mm');
    expect(selectedArtworkLightTargets(project, ['a', 'b'], 'outer')).toHaveLength(2);
  });

  it('keeps different jig copies selectable even when they share a source or group', () => {
    const first = registrationJigCopyId('logo', 'board-a');
    const second = registrationJigCopyId('logo', 'board-b');
    const project = scene(
      [artwork(first), artwork(second, 60)],
      [{ id: 'combined', name: 'Both boards', objectIds: [first, second] }],
    );
    expect(
      selectedArtworkLightTargets(project, [first, second]).map((target) => target.objectIds),
    ).toEqual([[first], [second]]);
  });
});
