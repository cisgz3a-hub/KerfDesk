import {
  loadCompound as load,
  reopenCompoundProject as reopen,
} from './boolean-compound-workflow.test-fixture';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  operationIdsForObject,
  replaceSceneObjectOperationBinding,
  remapSceneObjectOperationBindings,
  bindSceneObjectToOperations,
  removeSceneObjectOperationBinding,
  assignObjectToLayer,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_LAYER_SETTINGS,
  type ImportedSvg,
} from '../../core/scene';
import { compoundRectangle } from '../../core/geometry/boolean-compound.test-fixture';
import { evaluateBooleanCompound } from '../../core/geometry/boolean-compound';
import { compileJob } from '../../core/job';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { serializeProject, deserializeProject } from '../../io/project';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { duplicateSceneSelection } from './duplicate-scene-selection';
import { sceneLimitOverrun, sceneCopyRoom } from './scene-copy-room';

beforeEach(() => resetStore());
describe('durable compound workflow', () => {
  it.each(['weld', 'subtract', 'intersect', 'exclude'] as const)(
    'creates %s with source identity, one output owner and undo/redo',
    (operation) => {
      const result = load(operation);
      const created = useStore.getState().project;
      expect(created.scene.objects).toHaveLength(1);
      expect(result.booleanCompound.operands.map((operand) => operand.sourceId)).toEqual([
        'subject',
        'clip',
      ]);
      expect(
        new Set(result.booleanCompound.operands.map((operand) => operand.object.id)).size,
      ).toBe(2);
      expect(useStore.getState().undoStack).toHaveLength(1);
      const output = compileJob(created.scene, DEFAULT_DEVICE_PROFILE);
      expect(output.groups.length).toBeGreaterThan(0);
      expect(output.groups.every((group) => group.sourceObjectId === result.id)).toBe(true);
      useStore.getState().undo();
      expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
        'subject',
        'clip',
      ]);
      useStore.getState().redo();
      expect(useStore.getState().project).toEqual(created);
      reopen();
      expect(useStore.getState().project.scene.objects[0]).toMatchObject({
        id: result.id,
        booleanCompound: { operation },
      });
      expect(compileJob(useStore.getState().project.scene, DEFAULT_DEVICE_PROFILE)).toEqual(output);
    },
  );
  it('reopens source-authoritative geometry even when the stored result cache is stale', () => {
    const result = load('subtract');
    const project = useStore.getState().project;
    const forged = {
      ...project,
      scene: {
        ...project.scene,
        objects: [
          {
            ...result,
            paths: compoundRectangle('stale').paths,
            bounds: { minX: -10, minY: -10, maxX: 100, maxY: 100 },
          },
        ],
      },
    };
    const reopened = deserializeProject(serializeProject(forged));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') return;
    expect(reopened.project.scene.objects[0]?.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 5,
      maxY: 10,
    });
    expect(compileJob(reopened.project.scene, DEFAULT_DEVICE_PROFILE)).toEqual(
      compileJob(project.scene, DEFAULT_DEVICE_PROFILE),
    );
  });
  it('refuses a saved compound whose retained sources evaluate to an empty result', () => {
    const result = load('intersect');
    const project = useStore.getState().project;
    const compound = {
      ...result.booleanCompound,
      operands: result.booleanCompound.operands.map((operand, index) =>
        index === 1
          ? {
              ...operand,
              object: { ...operand.object, transform: { ...operand.object.transform, x: 20 } },
            }
          : operand,
      ),
    };
    const invalid = {
      ...project,
      scene: { ...project.scene, objects: [{ ...result, booleanCompound: compound }] },
    };
    const reopened = deserializeProject(serializeProject(invalid));
    expect(reopened.kind).toBe('invalid');
  });
  it('sends only the current result contour to CNC and preserves it on reopen', () => {
    const result = load('subtract');
    const project = useStore.getState().project;
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [{ id: 'tool', name: 'End mill', kind: 'end-mill' as const, diameterMm: 1 }],
      toolId: 'tool',
    };
    const scene = {
      ...project.scene,
      layers: project.scene.layers.map((layer) => ({
        ...layer,
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'profile-on-path' as const,
          depthPerPassMm: 1,
          depthMm: 1,
        },
      })),
    };
    const output = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, machine);
    expect(output.groups.length).toBeGreaterThan(0);
    expect(output.groups.every((group) => group.sourceObjectId === result.id)).toBe(true);
    const reopened = deserializeProject(serializeProject({ ...project, scene, machine }));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') return;
    const reopenedMachine = reopened.project.machine;
    if (reopenedMachine?.kind !== 'cnc') throw new Error('Expected saved CNC machine');
    expect(compileCncJob(reopened.project.scene, DEFAULT_DEVICE_PROFILE, reopenedMachine)).toEqual(
      output,
    );
  });
  it('keeps earliest separate canvas and output positions, and prunes presentation metadata', () => {
    const objects = [
      compoundRectangle('before', 50),
      compoundRectangle('subject'),
      compoundRectangle('middle', 60),
      compoundRectangle('clip', 5),
      compoundRectangle('after', 70),
    ];
    useStore.setState({
      project: {
        ...createProject(),
        scene: {
          objects,
          layers: [createLayer({ id: 'cut', color: '#000000' })],
          artworkOrder: ['clip', 'middle', 'subject', 'after', 'before'],
          designTreeOrder: objects.map((object) => ({ kind: 'object' as const, id: object.id })),
        },
      },
      selectedObjectId: 'subject',
      additionalSelectedIds: new Set(['clip']),
    });
    useStore.getState().booleanSelection('subtract', { retainCompound: true });
    const scene = useStore.getState().project.scene;
    const result = scene.objects[1]!;
    expect(scene.objects.map((object) => object.id)).toEqual([
      'before',
      result.id,
      'middle',
      'after',
    ]);
    expect(scene.artworkOrder).toEqual([result.id, 'middle', 'after', 'before']);
    expect(scene.designTreeOrder?.map((ref) => ref.id)).toEqual(['before', 'middle', 'after']);
  });
  it('reevaluates an edit without allocating operations and rejects stale/empty edits', () => {
    const original = load('intersect');
    const project = useStore.getState().project;
    const layers = project.scene.layers;
    const edited = {
      ...original.booleanCompound,
      operands: original.booleanCompound.operands.map((operand, i) =>
        i === 1
          ? {
              ...operand,
              object: { ...operand.object, transform: { ...operand.object.transform, x: 8 } },
            }
          : operand,
      ),
    };
    useStore.getState().editBooleanCompound(original.id, edited, project);
    const next = useStore.getState().project;
    expect(next.scene.layers).toBe(layers);
    expect(next.scene.objects[0]?.bounds).toEqual({ minX: 8, minY: 0, maxX: 10, maxY: 10 });
    useStore.getState().editBooleanCompound(original.id, original.booleanCompound, project);
    expect(useStore.getState().project).toBe(next);
    const empty = {
      ...edited,
      operands: edited.operands.map((operand, i) =>
        i === 1
          ? {
              ...operand,
              object: { ...operand.object, transform: { ...operand.object.transform, x: 20 } },
            }
          : operand,
      ),
    };
    useStore.getState().editBooleanCompound(original.id, empty, next);
    expect(useStore.getState().project).toBe(next);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(project);
  });
  it('requires explicit expansion for result-node or vector edits, and restores intent with Undo', () => {
    const result = load();
    const project = useStore.getState().project;
    useStore
      .getState()
      .selectPathNode({ objectId: result.id, pathIndex: 0, polylineIndex: 0, pointIndex: 0 });
    useStore.getState().nudgeSelectedPathNode(1, 0);
    expect(useStore.getState().project).toBe(project);
    useStore.getState().convertSelectionToPath();
    expect(useStore.getState().project).toBe(project);
    useStore.getState().expandBooleanCompound(result.id, project);
    const expanded = useStore.getState().project.scene.objects[0];
    expect(expanded).not.toHaveProperty('booleanCompound');
    expect(expanded?.id).toBe(result.id);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(project);
  });
  it('retains isolated Weld output settings without recreating operations on source edits', () => {
    const subject = {
      ...compoundRectangle('subject'),
      powerScale: 25,
      operationOverride: { power: 80, speed: 321 },
    };
    const clip = compoundRectangle('clip', 5);
    useStore.setState({
      project: {
        ...createProject(),
        scene: {
          objects: [subject, clip],
          layers: [{ ...createLayer({ id: 'cut', color: '#000000' }), power: 10, speed: 100 }],
          groups: [],
        },
      },
      selectedObjectId: 'subject',
      additionalSelectedIds: new Set(['clip']),
    });
    useStore.getState().weldSelection({ retainCompound: true });
    const project = useStore.getState().project;
    const result = project.scene.objects[0];
    if (result === undefined || !isBooleanCompoundObject(result))
      throw new Error('Missing compound');
    const settings = compileJob(project.scene, DEFAULT_DEVICE_PROFILE)
      .groups.filter((group) => group.kind !== 'cnc')
      .map((group) => ({
        layerId: group.layerId,
        power: group.power,
        speed: group.speed,
      }));
    expect(settings.map((group) => [group.power, group.speed])).toEqual([
      [10, 100],
      [20, 321],
    ]);
    const edited = {
      ...result.booleanCompound,
      operands: result.booleanCompound.operands.map((operand, index) =>
        index === 0
          ? {
              ...operand,
              object: { ...operand.object, transform: { ...operand.object.transform, y: 1 } },
            }
          : operand,
      ),
    };
    useStore.getState().editBooleanCompound(result.id, edited, project);
    expect(useStore.getState().project.scene.layers).toBe(project.scene.layers);
    expect(
      compileJob(useStore.getState().project.scene, DEFAULT_DEVICE_PROFILE)
        .groups.filter((group) => group.kind !== 'cnc')
        .map((group) => ({
          layerId: group.layerId,
          power: group.power,
          speed: group.speed,
        })),
    ).toEqual(settings);
    const before = compileJob(useStore.getState().project.scene, DEFAULT_DEVICE_PROFILE);
    reopen();
    expect(compileJob(useStore.getState().project.scene, DEFAULT_DEVICE_PROFILE)).toEqual(before);
  });
  it('copies retained sources independently without adding hidden output owners', () => {
    const result = load();
    const original = useStore.getState().project.scene;
    const duplicate = duplicateSceneSelection(original, [result.id], (id) => `${id}-copy`);
    expect(duplicate.scene.objects).toHaveLength(2);
    const copied = duplicate.scene.objects[1];
    expect(copied).toHaveProperty('booleanCompound');
    if (copied === undefined || !isBooleanCompoundObject(copied)) return;
    expect(copied.booleanCompound).toEqual(result.booleanCompound);
    expect(copied.booleanCompound).not.toBe(result.booleanCompound);
    expect(copied.booleanCompound.operands[0]?.object.paths).not.toBe(
      result.booleanCompound.operands[0]?.object.paths,
    );
  });
  it('counts nested retained sources against the same scene object budget', () => {
    const result = load();
    const scene = useStore.getState().project.scene;
    const almost = {
      ...scene,
      objects: [
        ...Array.from({ length: 9997 }, (_, i) => compoundRectangle(`normal-${i}`)),
        result,
      ],
    };
    expect(sceneCopyRoom(almost, new Set([result.id]))).toBe(0);
    expect(sceneCopyRoom(almost, new Set([result.id]), 1)).toBe(1);
    expect(
      sceneLimitOverrun(scene, {
        ...almost,
        objects: [...almost.objects, compoundRectangle('extra')],
      }),
    ).toContain('10000 objects');
  });
  it('preserves result and retained Weld source colours through colour edits and reopen', () => {
    const result = load('weld');
    const project = useStore.getState().project;
    const scene = assignObjectToLayer(project.scene, result.id, '#123456');
    const edited = scene.objects[0];
    if (edited === undefined || !isBooleanCompoundObject(edited))
      throw new Error('Missing compound');
    expect(edited.paths.every((path) => path.color === '#123456')).toBe(true);
    expect(
      edited.booleanCompound.operands.every((operand) =>
        operand.object.paths.every((path) => path.color === '#123456'),
      ),
    ).toBe(true);
    useStore.setState({ project: { ...project, scene } });
    const output = compileJob(scene, DEFAULT_DEVICE_PROFILE);
    reopen();
    expect(useStore.getState().project.scene.objects[0]).toMatchObject({
      paths: [{ color: '#123456' }],
    });
    expect(compileJob(useStore.getState().project.scene, DEFAULT_DEVICE_PROFILE)).toEqual(output);
  });
  it('keeps explicitly removed Weld bindings output-inert after source reevaluation', () => {
    const result = load('weld');
    const project = useStore.getState().project;
    const removed = removeSceneObjectOperationBinding(result, 'cut', project.scene.layers);
    expect(removed).toBeNull();
    // Removing its final binding intentionally deletes artwork in the existing caller contract.
    const inert = bindSceneObjectToOperations(result, []) as ImportedSvg;
    expect(
      compileJob({ ...project.scene, objects: [inert] }, DEFAULT_DEVICE_PROFILE).groups,
    ).toHaveLength(0);
    const refreshed = evaluateBooleanCompound(inert);
    expect(refreshed.kind).toBe('ok');
    if (refreshed.kind !== 'ok') return;
    expect(
      compileJob({ ...project.scene, objects: [refreshed.value] }, DEFAULT_DEVICE_PROFILE).groups,
    ).toHaveLength(0);
  });
  it('keeps Weld fragment output bindings in sync through assignment, replacement and copy remapping', () => {
    const result = load('weld');
    const layers = useStore.getState().project.scene.layers;
    const assigned = bindSceneObjectToOperations(result, ['new']) as ImportedSvg;
    expect(
      assigned.paths.every((path) => (path.operationIds ?? assigned.operationIds)?.includes('new')),
    ).toBe(true);
    expect(
      assigned.booleanCompound?.operands.every((operand) =>
        operand.object.operationIds?.includes('new'),
      ),
    ).toBe(true);
    const replaced = replaceSceneObjectOperationBinding(
      result,
      'cut',
      'new',
      layers,
    ) as ImportedSvg;
    expect(
      replaced.booleanCompound?.operands.every((operand) =>
        operand.object.paths.every((path) => path.operationIds?.includes('new')),
      ),
    ).toBe(true);
    const mapped = remapSceneObjectOperationBindings(
      result,
      layers,
      new Map([['cut', 'copied']]),
    ) as ImportedSvg;
    const refreshed = evaluateBooleanCompound(mapped);
    expect(refreshed.kind).toBe('ok');
    if (refreshed.kind !== 'ok') return;
    expect(
      operationIdsForObject(refreshed.value, [createLayer({ id: 'copied', color: '#000000' })]),
    ).toEqual(['copied']);
  });
});
