import { afterEach, describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc';
import { effectiveOperationForObject } from '../../core/effective-output';
import { compileJob } from '../../core/job';
import {
  captureLayerOperationSettings,
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  layerFromSubLayer,
  operationIdsForObject,
  type ObjectOperationOverride,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';

afterEach(resetStore);

describe('operation-owned settings through persisted editor mutations', () => {
  it('does not write a new scope when a legacy root ID also names another operation child', () => {
    const project = fixture({ power: 17 });
    const scene = {
      objects: project.scene.objects.map((object) => ({
        ...object,
        operationIds: ['shared', 'shared:finish'],
      })),
      layers: [...project.scene.layers, createLayer({ id: 'shared:finish', color: '#ff0000' })],
    };
    load(reopen({ ...project, scene }));
    const before = useStore.getState().project;
    useStore
      .getState()
      .setObjectsOperationOverrideForOperation(['chosen'], 'shared:finish', { power: 11 });
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toEqual([]);
    expect(reopen(useStore.getState().project)).toEqual(before);
  });

  it('applies air-assist defaults to explicit parent and child scopes without losing other settings', () => {
    load(
      fixture({
        airAssist: false,
        power: 17,
        byOperation: {
          shared: { power: 23, airAssist: false },
          'shared:finish': { power: 11, airAssist: false },
        },
      }),
    );
    expect(useStore.getState().syncProjectAirAssistDefaults().disabledObjectOverrideCount).toBe(1);
    const after = useStore.getState().project;
    const output = compileJob(after.scene, after.device).groups;
    expect(output.map((group) => (group.kind === 'cnc' ? null : group.airAssist))).toEqual([
      true,
      true,
    ]);
    expect(laserFacts(after).map((group) => group.power)).toEqual([23, 11]);
    expect(useStore.getState().syncProjectAirAssistDefaults().disabledObjectOverrideCount).toBe(0);
    expect(reopen(after)).toEqual(after);
  });

  it.each(['add', 'make unique'] as const)(
    '%s remaps child scopes without changing other output',
    (action) => {
      load(fixture({ power: 17, speed: 600, byOperation: { 'shared:finish': null } }));
      const before = useStore.getState().project;
      if (action === 'add') useStore.getState().addOperationForSelection();
      else useStore.getState().makeSelectedOperationUnique('shared');
      const after = useStore.getState().project;
      const added = after.scene.layers.at(-1)!;
      expect(laserFacts(after)).toEqual(
        action === 'add' ? [...laserFacts(before), ...laserFacts(before)] : laserFacts(before),
      );
      expect(
        after.scene.objects[0]?.operationOverride?.byOperation?.[`${added.id}:finish`],
      ).toBeNull();
      useStore
        .getState()
        .setObjectsOperationOverrideForOperation(['chosen'], added.id, { power: 23 });
      expect(laserFacts(useStore.getState().project).map((group) => group.power)).toEqual(
        action === 'add' ? [17, 8, 23, 8] : [23, 8],
      );
      useStore
        .getState()
        .setObjectsOperationOverrideForOperation(['chosen'], `${added.id}:finish`, { power: 11 });
      expect(laserFacts(useStore.getState().project).map((group) => group.power)).toEqual(
        action === 'add' ? [17, 8, 23, 11] : [23, 11],
      );
      expect(laserFacts(reopen(useStore.getState().project))).toEqual(
        laserFacts(useStore.getState().project),
      );
    },
  );

  it('keeps independent edits for heterogeneous global, scoped, null, and inherited owners', () => {
    const first = fixture({ power: 17, speed: 600 });
    const base = first.scene.objects[0]!;
    const objects = [
      base,
      {
        ...base,
        id: 'scoped',
        operationOverride: { power: 99, byOperation: { shared: { power: 42, speed: 800 } } },
      },
      { ...base, id: 'null', operationOverride: { power: 99, byOperation: { shared: null } } },
      { ...base, id: 'inherited', operationOverride: undefined },
    ] as SceneObject[];
    const project = reopen({
      ...first,
      scene: { objects, layers: [{ ...first.scene.layers[0]!, subLayers: [] }] },
    });
    load(project);
    useStore.setState({ additionalSelectedIds: new Set(['scoped', 'null', 'inherited']) });
    useStore.getState().addOperationForSelection();
    const copied = useStore.getState().project;
    const added = copied.scene.layers.at(-1)!;
    expect(copied.scene.layers).toHaveLength(2);
    for (const object of objects) {
      const expected = laserFacts(project, object.id);
      expect(laserFacts(copied, object.id)).toEqual([...expected, ...expected]);
    }
    useStore.getState().setObjectsOperationOverrideForOperation(
      objects.map(({ id }) => id),
      added.id,
      { power: 23 },
    );
    const edited = useStore.getState().project;
    for (const object of objects) {
      expect(laserFacts(edited, object.id)[0]).toEqual(laserFacts(project, object.id)[0]);
      expect(laserFacts(edited, object.id)[1]?.power).toBe(23);
    }
    expect(objects.map(({ id }) => laserFacts(reopen(edited), id))).toEqual(
      objects.map(({ id }) => laserFacts(edited, id)),
    );
    useStore.getState().undo();
    expect(useStore.getState().project).toEqual(copied);
    useStore.getState().redo();
    expect(useStore.getState().project).toEqual(edited);
  });

  it('keeps an existing CNC pocket and its hole together when Add creates a new operation', () => {
    const source = {
      ...createLayer({ id: 'shared', color: '#000000' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket' as const, depthMm: 1 },
    };
    const outer = { ...rectangle('chosen', 20), operationOverride: { power: 17, speed: 600 } };
    const hole = { ...rectangle('hole', 5), transform: { ...outer.transform, x: 7.5, y: 7.5 } };
    load(
      reopen({
        ...createProject(),
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        scene: { objects: [outer, hole], layers: [source] },
      }),
    );
    const before = useStore.getState().project;
    const original = cncGroups(before);
    expect(original).toHaveLength(1);
    expect(original[0]?.passes).toHaveLength(4);
    useStore.getState().addOperationForSelection();
    const added = useStore.getState().project;
    expect(added.scene.layers).toHaveLength(2);
    expect(operationIdsForObject(added.scene.objects[1]!, added.scene.layers)).toEqual(['shared']);
    expect(cncGroups(added)[0]).toEqual(original[0]);
    expect(cncGroups(added)).toHaveLength(2);
    expect(cncGroups(reopen(added))).toEqual(cncGroups(added));
    const newOperation = added.scene.layers.at(-1)!;
    useStore.getState().setLayerParam(newOperation.id, { cnc: { ...source.cnc, depthMm: 2 } });
    const edited = useStore.getState().project;
    expect(cncGroups(edited)[0]).toEqual(original[0]);
    expect(cncGroups(edited)[1]).not.toEqual(cncGroups(added)[1]);
    // Switching the same document to laser retains each legacy output and a
    // separately editable copy; laser scopes never split CNC compound geometry.
    const laser = reopen({ ...edited, machine: { kind: 'laser' } });
    expect(laserFacts(laser).map((group) => group.power)).toEqual([17, 17]);
    expect(laserFacts(laser, 'hole').map((group) => group.power)).toEqual([30]);
    useStore.setState({ project: laser });
    useStore
      .getState()
      .setObjectsOperationOverrideForOperation(['chosen'], newOperation.id, { power: 23 });
    const laserEdited = useStore.getState().project;
    expect(laserFacts(laserEdited).map((group) => group.power)).toEqual([17, 23]);
    expect(cncGroups(reopen({ ...laserEdited, machine: DEFAULT_CNC_MACHINE_CONFIG }))).toEqual(
      cncGroups(edited),
    );
    useStore.getState().undo();
    expect(useStore.getState().project).toEqual(laser);
    useStore.getState().redo();
    expect(useStore.getState().project).toEqual(laserEdited);
  });

  it('copies scopes through Duplicate, transforms, and clipboard operation-ID remapping', () => {
    load(
      fixture({
        power: 17,
        speed: 600,
        byOperation: { shared: { power: 23 }, 'shared:finish': null },
      }),
    );
    const before = useStore.getState().project;
    useStore.getState().duplicateSelection();
    const duplicate = useStore.getState().project.scene.objects[1]!;
    expect(duplicate.operationOverride).toEqual(before.scene.objects[0]?.operationOverride);
    expect(duplicate.operationOverride).not.toBe(before.scene.objects[0]?.operationOverride);
    useStore.getState().nudgeSelection(4, 3);
    useStore.getState().flipSelection('horizontal');
    const transformed = useStore.getState().project;
    expect(laserFacts(reopen(transformed), duplicate.id)).toEqual(laserFacts(before));
    useStore.getState().copySelection();
    useStore.getState().setProject({
      ...createProject(),
      scene: {
        objects: [],
        layers: [{ ...createLayer({ id: 'shared', color: '#ff0000' }), power: 90 }],
      },
    });
    useStore.getState().pasteClipboard();
    const pasted = useStore.getState().project;
    const object = pasted.scene.objects[0]!;
    const operation = pasted.scene.layers.at(-1)!;
    expect(operation.id).not.toBe('shared');
    expect(object.operationOverride).toEqual({
      power: 17,
      speed: 600,
      byOperation: { [operation.id]: { power: 23 }, [`${operation.id}:finish`]: null },
    });
    expect(laserFacts(reopen(pasted), object.id)).toEqual(laserFacts(before));
    const sub = layerFromSubLayer(operation, operation.subLayers[0]!);
    expect(effectiveOperationForObject(sub, object).power).toBe(8);
  });

  it('ignores stale inspector callbacks for artwork no longer bound to the operation', () => {
    load(fixture({ power: 17 }));
    useStore.getState().makeSelectedOperationUnique('shared');
    const before = useStore.getState().project;
    const undoCount = useStore.getState().undoStack.length;
    useStore
      .getState()
      .setObjectsOperationOverrideForOperation(['chosen'], 'shared', { power: 99 });
    useStore
      .getState()
      .setObjectsOperationOverrideForOperation(['chosen'], 'shared:finish', { power: 99 });
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(undoCount);
  });

  it('prunes removed parent and child scopes so save/reopen cannot revive deleted owners', () => {
    load(fixture({ power: 17, byOperation: { shared: { power: 23 }, 'shared:finish': null } }));
    useStore.getState().addOperationForSelection();
    const newId = useStore.getState().project.scene.layers.at(-1)!.id;
    useStore.getState().deleteLayerSubLayer(newId, 'finish');
    expect(
      useStore.getState().project.scene.objects[0]?.operationOverride?.byOperation,
    ).not.toHaveProperty(`${newId}:finish`);
    useStore.getState().deleteLayerAndObjects('shared');
    const after = useStore.getState().project;
    expect(after.scene.objects[0]?.operationOverride?.byOperation).toEqual({
      [newId]: { power: 23 },
    });
    expect(laserFacts(reopen(after))).toEqual(laserFacts(after));
  });
});

function fixture(operationOverride: ObjectOperationOverride): Project {
  const base = createLayer({ id: 'shared', color: '#000000' });
  const source = {
    ...base,
    subLayers: [
      {
        id: 'finish',
        label: 'Finish',
        enabled: true,
        settings: { ...captureLayerOperationSettings(base), power: 8, speed: 400 },
      },
    ],
  };
  return reopen({
    ...createProject(),
    scene: {
      objects: [{ ...rectangle('chosen', 5), operationOverride }],
      layers: [source],
    },
  });
}

function rectangle(id: string, size: number) {
  return {
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: size, heightMm: size, cornerRadiusMm: 0 },
    }),
    operationIds: ['shared'],
  };
}

function load(project: Project) {
  useStore.setState({
    project,
    selectedObjectId: 'chosen',
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}

function reopen(project: Project): Project {
  const loaded = deserializeProject(serializeProject(project));
  if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
  return loaded.project;
}

function laserFacts(project: Project, objectId = 'chosen') {
  return compileJob(
    { ...project.scene, objects: project.scene.objects.filter(({ id }) => id === objectId) },
    project.device,
  ).groups.map((group) => {
    if (group.kind === 'cnc') throw new Error('Expected laser');
    return { kind: group.kind, power: group.power, speed: group.speed, passes: group.passes };
  });
}

function cncGroups(project: Project) {
  return compileCncJob(project.scene, project.device, DEFAULT_CNC_MACHINE_CONFIG).groups;
}
