import { describe, expect, it } from 'vitest';
import { createProject, type SceneGroup } from '../../core/scene';
import { svgObj } from '../../ui/state/test-helpers';
import { deserializeProject, serializeProject } from './index';
function project(groups: ReadonlyArray<SceneGroup>) {
  const base = createProject();
  return {
    ...base,
    scene: { ...base.scene, objects: ['A', 'B', 'C'].map((id) => svgObj(id, ['#000000'])), groups },
  };
}
const valid: ReadonlyArray<SceneGroup> = [
  { id: 'outer', name: 'Assembly', objectIds: ['A', 'B', 'C'] },
  { id: 'child', name: 'Pair', objectIds: ['A', 'B'], parentId: 'outer' },
];
describe('design hierarchy persistence validation', () => {
  it('roundtrips nested groups and preserves flat overlapping legacy groups', () => {
    for (const groups of [
      valid,
      [
        { id: 'one', name: 'One', objectIds: ['A', 'B'] },
        { id: 'two', name: 'Two', objectIds: ['B', 'C'] },
      ],
    ]) {
      const loaded = deserializeProject(serializeProject(project(groups)));
      expect(loaded.kind).toBe('ok');
      if (loaded.kind === 'ok') expect(loaded.project.scene.groups).toEqual(groups);
    }
  });
  it.each(
    [
      [{ ...valid[0]!, parentId: 'child' }, valid[1]!],
      [valid[0]!, { ...valid[1]!, parentId: 'missing' }],
      [{ ...valid[0]!, objectIds: ['A', 'C'] }, valid[1]!],
      [valid[0]!, { ...valid[1]!, parentId: 123 }],
    ].map((groups) => [groups]),
  )('rejects cyclic, dangling, non-containing or malformed parent links %#', (groups) => {
    expect(
      deserializeProject(JSON.stringify(project(groups as ReadonlyArray<SceneGroup>))),
    ).toMatchObject({ kind: 'invalid', reason: expect.stringContaining('parentId') });
  });
  it('rejects malformed common artwork names', () => {
    const base = project(valid);
    expect(
      deserializeProject(
        JSON.stringify({
          ...base,
          scene: {
            ...base.scene,
            objects: base.scene.objects.map((object) => ({ ...object, name: [] })),
          },
        }),
      ),
    ).toMatchObject({ kind: 'invalid', reason: expect.stringContaining('.name') });
  });
});
