import { afterEach, describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import {
  captureLayerOperationSettings,
  createLayer,
  createProject,
  layerFromSubLayer,
  operationIdsForObject,
  type Layer,
  type Project,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';

afterEach(resetStore);

describe('new operation and sub-operation identity allocation', () => {
  it.each(['root', 'child'] as const)(
    'Add avoids an existing %s identity collision and preserves original output',
    (collision) => {
      const source = operation('shared', '#000000', collision === 'child');
      const objectId = collision === 'root' ? 'art:finish' : 'art';
      const existing = operation(
        collision === 'root' ? 'operation-art' : 'operation-art:finish',
        '#ff0000',
        collision === 'root',
      );
      const object = {
        ...rectangle(objectId),
        operationOverride: {
          power: 17,
          ...(collision === 'child' ? { byOperation: { 'shared:finish': null } } : {}),
        },
      };
      const before = reopen({
        ...createProject(),
        scene: { objects: [object], layers: [source, existing] },
      });
      useStore.setState({
        project: before,
        selectedObjectId: object.id,
        additionalSelectedIds: new Set(),
        undoStack: [],
        redoStack: [],
        dirty: false,
      });
      useStore.getState().addOperationForSelection();
      const after = useStore.getState().project;
      const newOperation = after.scene.layers.at(-1)!;
      expect(newOperation.id).not.toBe(`operation-${object.id}`);
      expect(after.scene.layers.slice(0, 2)).toEqual(before.scene.layers);
      expectUniqueIds(after.scene.layers);
      const original = compileJob(before.scene, before.device).groups;
      const output = compileJob(after.scene, after.device).groups;
      expect(output.slice(0, original.length)).toEqual(original);
      expect(output).toHaveLength(original.length * 2);
      expect(reopen(after)).toEqual(after);
      useStore
        .getState()
        .setObjectsOperationOverrideForOperation([object.id], newOperation.id, { power: 23 });
      const edited = useStore.getState().project;
      expect(compileJob(edited.scene, edited.device).groups.slice(0, original.length)).toEqual(
        original,
      );
      expect(reopen(edited)).toEqual(edited);
      useStore.getState().undo();
      expect(useStore.getState().project).toEqual(after);
      useStore.getState().redo();
      expect(useStore.getState().project).toEqual(edited);
    },
  );

  it('clipboard copying reserves copied child identities before assigning a new parent ID', () => {
    const object = {
      ...rectangle('art'),
      operationOverride: { power: 17, byOperation: { 'shared:finish': null } },
    };
    const before = reopen({
      ...createProject(),
      scene: { objects: [object], layers: [operation('shared', '#000000', true)] },
    });
    useStore.setState({
      project: before,
      selectedObjectId: object.id,
      additionalSelectedIds: new Set(),
    });
    useStore.getState().copySelection();
    useStore.getState().setProject(
      reopen({
        ...createProject(),
        scene: { objects: [], layers: [operation('operation-art:finish', '#ff0000', false)] },
      }),
    );
    useStore.getState().pasteClipboard();
    const after = useStore.getState().project;
    const pasted = after.scene.objects[0]!;
    const copiedId = operationIdsForObject(pasted, after.scene.layers)[0]!;
    expect(copiedId).not.toBe('operation-art');
    expectUniqueIds(after.scene.layers);
    expect(pasted.operationOverride?.byOperation).toEqual({ [`${copiedId}:finish`]: null });
    expect(reopen(after)).toEqual(after);
  });
});

function rectangle(id: string) {
  return {
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 5, heightMm: 5, cornerRadiusMm: 0 },
    }),
    operationIds: ['shared'],
  };
}

function operation(id: string, color: string, withChild: boolean): Layer {
  const base = createLayer({ id, color });
  return {
    ...base,
    subLayers: withChild
      ? [
          {
            id: 'finish',
            label: 'Finish',
            enabled: true,
            settings: { ...captureLayerOperationSettings(base), power: 8 },
          },
        ]
      : [],
  };
}

function reopen(project: Project): Project {
  const loaded = deserializeProject(serializeProject(project));
  if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
  return loaded.project;
}

function expectUniqueIds(layers: ReadonlyArray<Layer>): void {
  const ids = layers.flatMap((layer) => [
    layer.id,
    ...layer.subLayers.map((sub) => layerFromSubLayer(layer, sub).id),
  ]);
  expect(new Set(ids).size).toBe(ids.length);
}
