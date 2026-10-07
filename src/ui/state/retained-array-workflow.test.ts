import { describe, expect, it } from 'vitest';
import type { AppState } from './store';
import type { ArraySpec, Project } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { materializeVariableText } from '../../io/gcode/prepare-output-snapshot';
import { applyArraySelection } from './array-actions';
import { prepareVariableArray } from './prepare-variable-array';
import { regenerateRetainedArray, retainedArraySource } from './retained-array-regeneration';
import { retainedArrayChanged } from './retained-array-capture';
import { fixtureState, NOW, renderFixture, textValues } from './variable-array-test-fixture';
import { useStore } from './store';
import { svgObj } from './test-helpers';

const grid = (columns: number): ArraySpec => ({
  kind: 'grid',
  rows: 1,
  columns,
  spacingX: 4,
  spacingY: 0,
});
const idFactory = () => {
  let id = 0;
  return () => `generated-${id++}`;
};
async function retained(
  before = fixtureState(),
  columns = 2,
  advanceVariables = true,
): Promise<AppState> {
  const spec = grid(columns);
  const prepared = await prepareVariableArray(before, spec, {
    render: renderFixture,
    clock: () => NOW,
    advanceVariables,
  });
  if (!prepared.ok) throw new Error(prepared.message);
  const patch = applyArraySelection(before, spec, idFactory(), prepared.materialized, {
    name: 'Badges',
    advanceVariables,
  });
  return { ...before, ...patch };
}
function reopened(project: Project): Project {
  const parsed = deserializeProject(serializeProject(project));
  if (parsed.kind !== 'ok') throw new Error(JSON.stringify(parsed));
  return parsed.project;
}

describe('retained array ownership and fixed allocation', () => {
  it('round-trips stable identities and freezes owned output after CSV, serial and date change', async () => {
    const before = fixtureState(),
      created = await retained(before);
    const project = reopened(created.project),
      layout = project.arrayLayouts![0]!;
    expect(project.arrayLayouts).toEqual(created.project.arrayLayouts);
    expect(project.variables).toEqual(before.project.variables);
    expect(retainedArrayChanged(project, layout)).toBe(false);
    const moved = {
      ...project,
      variables: {
        ...project.variables!,
        serialValue: 999,
        recordIndex: 1,
        csv: { sourceName: 'later.csv', headers: ['name'], records: [['Changed'], ['Later']] },
      },
    };
    const rendered = await materializeVariableText(
      moved,
      { now: new Date('2030-01-01') },
      renderFixture,
    );
    expect(rendered.ok && textValues(rendered.project)).toEqual(textValues(created.project));
    expect(retainedArraySource(moved, layout)?.variables).toEqual(before.project.variables);
  });
  it.each([true, false])(
    'preserves allocated values and original member IDs when sequenced=%s',
    async (advanceVariables) => {
      const created = await retained(fixtureState(), 2, advanceVariables),
        layout = created.project.arrayLayouts![0]!;
      const changed = {
        ...created,
        project: {
          ...created.project,
          variables: { ...created.project.variables!, recordIndex: 4, serialValue: 800 },
        },
      };
      const source = retainedArraySource(changed.project, layout)!;
      const prepared = await prepareVariableArray({ ...changed, project: source }, grid(3), {
        render: renderFixture,
        clock: () => new Date(layout.evaluationTime!),
        advanceVariables,
      });
      if (!prepared.ok) throw new Error(prepared.message);
      const result = regenerateRetainedArray(
        changed,
        layout,
        grid(3),
        prepared.materialized,
        idFactory(),
      );
      if (!result.ok) throw new Error(result.reason);
      expect(result.project.arrayLayouts![0]!.instances.slice(0, 2)).toEqual(layout.instances);
      expect(result.project.arrayLayouts![0]!.advanceVariables).toBe(advanceVariables);
      expect(textValues(result.project).filter((_, i) => i % 3 === 0)).toEqual(
        advanceVariables
          ? ['A-010', 'B'.repeat(40) + '-011', 'CCC-012']
          : ['A-010', 'A-010', 'A-010'],
      );
      const loaded = reopened(result.project);
      expect(retainedArrayChanged(loaded, loaded.arrayLayouts![0]!)).toBe(false);
      expect(loaded.variables).toEqual(changed.project.variables);
      const saved = { ...changed, project: loaded },
        savedLayout = loaded.arrayLayouts![0]!;
      const smallerSource = retainedArraySource(loaded, savedLayout)!;
      const smaller = await prepareVariableArray({ ...saved, project: smallerSource }, grid(1), {
        render: renderFixture,
        clock: () => new Date(savedLayout.evaluationTime!),
        advanceVariables,
      });
      if (!smaller.ok) throw new Error(smaller.message);
      const shrunk = regenerateRetainedArray(saved, savedLayout, grid(1), smaller.materialized);
      if (!shrunk.ok) throw new Error(shrunk.reason);
      expect(shrunk.project.arrayLayouts![0]!.instances).toEqual(layout.instances.slice(0, 1));
      expect(shrunk.project.scene.objects).toHaveLength(3);
      expect(textValues(shrunk.project)[0]).toBe('A-010');
    },
  );
  it('keeps a captured date token fixed at output and explicit regeneration', async () => {
    const before = fixtureState();
    const objects = before.project.scene.objects.map((object, index) =>
      index === 0 && object.kind === 'text'
        ? {
            ...object,
            variableTemplate: {
              tokens: [{ kind: 'date-time' as const, format: 'datetime-iso' as const }],
            },
          }
        : object,
    );
    const created = await retained({
      ...before,
      project: { ...before.project, scene: { ...before.project.scene, objects } },
    });
    const values = textValues(created.project),
      layout = created.project.arrayLayouts![0]!;
    const output = await materializeVariableText(
      created.project,
      { now: new Date('2030-01-01') },
      renderFixture,
    );
    expect(output.ok && textValues(output.project)).toEqual(values);
    const source = retainedArraySource(created.project, layout)!;
    const prepared = await prepareVariableArray({ ...created, project: source }, grid(3), {
      render: renderFixture,
      clock: () => new Date(layout.evaluationTime!),
    });
    if (!prepared.ok) throw new Error(prepared.message);
    const regenerated = regenerateRetainedArray(created, layout, grid(3), prepared.materialized);
    if (!regenerated.ok) throw new Error(regenerated.reason);
    expect(textValues(regenerated.project)[0]).toBe(values[0]);
  });
  it('refuses member edits or deletions and preserves changes on explicit expansion', async () => {
    const created = await retained(),
      layout = created.project.arrayLayouts![0]!;
    const id = layout.ownedObjectIds[0]!;
    const edited = {
      ...created,
      project: {
        ...created.project,
        scene: {
          ...created.project.scene,
          objects: created.project.scene.objects.map((object) =>
            object.id === id ? { ...object, name: 'Override', powerScale: 75 } : object,
          ),
        },
      },
    };
    expect(regenerateRetainedArray(edited, layout, grid(3))).toMatchObject({ ok: false });
    const deleted = {
      ...created,
      project: {
        ...created.project,
        scene: {
          ...created.project.scene,
          objects: created.project.scene.objects.filter((object) => object.id !== id),
        },
      },
    };
    expect(regenerateRetainedArray(deleted, layout, grid(3))).toMatchObject({ ok: false });
    expect(edited.project.scene.objects.find((object) => object.id === id)?.name).toBe('Override');
    useStore.setState(edited);
    useStore.getState().expandArrayLayout(layout.id);
    expect(useStore.getState().project.scene).toBe(edited.project.scene);
    expect(useStore.getState().project.arrayLayouts).toEqual([]);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(edited.project);
  });
  it('keeps nested groups and unrelated stacking and output-order positions during regeneration', () => {
    const before = fixtureState();
    const objects = [
      svgObj('background', ['#000000']),
      svgObj('a', ['#000000']),
      svgObj('b', ['#000000']),
      svgObj('c', ['#000000']),
    ];
    const state = {
      ...before,
      selectedObjectId: 'a',
      additionalSelectedIds: new Set(['b', 'c']),
      project: {
        ...before.project,
        scene: {
          ...before.project.scene,
          objects,
          artworkOrder: ['background', 'c', 'a', 'b'],
          groups: [
            { id: 'outer', name: 'Assembly', objectIds: ['a', 'b', 'c'] },
            { id: 'inner', parentId: 'outer', name: 'Pair', objectIds: ['a', 'b'] },
          ],
        },
      },
    };
    const created = {
      ...state,
      ...applyArraySelection(state, grid(2), idFactory(), undefined, { name: 'Parts' }),
    };
    const layout = created.project.arrayLayouts![0]!,
      oldIds = new Set(created.project.scene.objects.map((object) => object.id));
    const result = regenerateRetainedArray(created, layout, grid(3), undefined, () =>
      crypto.randomUUID(),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(
      result.project.scene.objects
        .filter((object) => oldIds.has(object.id))
        .map((object) => object.id),
    ).toEqual(created.project.scene.objects.map((object) => object.id));
    expect(result.project.scene.artworkOrder?.slice(0, 4)).toEqual(['background', 'c', 'a', 'b']);
    expect(result.project.scene.groups).toHaveLength(6);
    expect(reopened(result.project).scene.groups).toEqual(result.project.scene.groups);
    expect(result.project.scene.objects[0]).toBe(objects[0]);
  });
  it('protects shared source groups at identity placement and avoids group ID collisions on regeneration', () => {
    const before = fixtureState(),
      objects = ['a', 'b', 'outside'].map((id) => svgObj(id, ['#000000']));
    const originalGroup = {
      id: 'source-group',
      name: 'Original assembly',
      objectIds: objects.map((object) => object.id),
    };
    const state = {
      ...before,
      selectedObjectId: 'a',
      additionalSelectedIds: new Set(['b']),
      project: {
        ...before.project,
        scene: { ...before.project.scene, objects, groups: [originalGroup] },
      },
    };
    const created = {
      ...state,
      ...applyArraySelection(state, grid(2), idFactory(), undefined, { name: 'Parts' }),
    };
    expect(created.project.scene.objects.slice(0, 3)).toEqual(objects);
    expect(created.project.scene.groups?.[0]).toBe(originalGroup);
    const result = regenerateRetainedArray(created, created.project.arrayLayouts![0]!, grid(3));
    if (!result.ok) throw new Error(result.reason);
    expect(result.project.scene.groups?.[0]).toBe(originalGroup);
    expect(new Set(result.project.scene.groups?.map((group) => group.id)).size).toBe(
      result.project.scene.groups?.length,
    );
    expect(reopened(result.project).scene.objects.slice(0, 3)).toMatchObject(objects);
  });
  it('refuses growth that exceeds the merged document budget', () => {
    const before = fixtureState(),
      object = svgObj('part', ['#000000']);
    const state = {
      ...before,
      selectedObjectId: object.id,
      additionalSelectedIds: new Set<string>(),
      project: {
        ...before.project,
        scene: { ...before.project.scene, objects: [object], groups: [] },
      },
    };
    const created = {
      ...state,
      ...applyArraySelection(state, grid(1), idFactory(), undefined, { name: 'Part' }),
    };
    const full = {
      ...created,
      project: {
        ...created.project,
        scene: {
          ...created.project.scene,
          objects: [
            ...created.project.scene.objects,
            ...Array.from({ length: 9999 }, (_, i) => ({ ...object, id: `outside-${i}` })),
          ],
        },
      },
    };
    const result = regenerateRetainedArray(full, full.project.arrayLayouts![0]!, grid(2));
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('limit') });
    expect(full.project.scene.objects).toHaveLength(10000);
  });
  it('does not snapshot stale variable geometry when retained preparation is missing', () => {
    const before = fixtureState();
    expect(applyArraySelection(before, grid(2), idFactory(), undefined, { name: 'Badges' })).toBe(
      before,
    );
  });
});
