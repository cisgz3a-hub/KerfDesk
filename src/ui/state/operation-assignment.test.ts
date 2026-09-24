import { beforeEach, describe, expect, it } from 'vitest';
import {
  createRegistrationLayer,
  operationIdsForObject,
  type ObjectOperationOverride,
  type SceneObject,
} from '../../core/scene';
import { assignObjectsToOperation } from './operation-assignment';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

function operationsOf(objectId: string): ReadonlyArray<string> {
  const { objects, layers } = useStore.getState().project.scene;
  const object = objects.find((candidate) => candidate.id === objectId);
  return object === undefined ? [] : operationIdsForObject(object, layers);
}

function onlyOperationOf(objectId: string): string {
  const [id] = operationsOf(objectId);
  if (id === undefined) throw new Error(`${objectId} has no operation`);
  return id;
}

function objectById(objectId: string): SceneObject {
  const object = useStore.getState().project.scene.objects.find((item) => item.id === objectId);
  if (object === undefined) throw new Error(`${objectId} missing`);
  return object;
}

function patchObject(objectId: string, patch: Partial<SceneObject>): void {
  const { project } = useStore.getState();
  const objects = project.scene.objects.map((object) =>
    object.id === objectId ? ({ ...object, ...patch } as SceneObject) : object,
  );
  useStore.setState({ project: { ...project, scene: { ...project.scene, objects } } });
}

describe('moving artwork onto an existing operation', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().importSvgObject(svgObj('Engraving', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('Outline', ['#0000ff']));
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });
  });

  it('moves one selected artwork in one undo step and removes the operation it emptied', () => {
    const target = onlyOperationOf('Engraving');
    const emptied = onlyOperationOf('Outline');
    useStore.getState().selectObject('Outline');

    useStore.getState().assignSelectionToLayer(target);

    const state = useStore.getState();
    expect(operationsOf('Outline')).toEqual([target]);
    expect(state.project.scene.layers.map((layer) => layer.id)).toEqual([target]);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);
    expect(state.selectedObjectId).toBe('Outline');

    useStore.getState().undo();
    expect(operationsOf('Outline')).toEqual([emptied]);
    expect(useStore.getState().project.scene.layers.map((layer) => layer.id)).toEqual([
      target,
      emptied,
    ]);
  });

  it('keeps the artwork-wide settings and drops settings held for the removed operation', () => {
    const target = onlyOperationOf('Engraving');
    const emptied = onlyOperationOf('Outline');
    const override: ObjectOperationOverride = {
      power: 55,
      byOperation: { [emptied]: { speed: 900 } },
    };
    patchObject('Outline', { operationOverride: override });

    useStore.getState().assignObjectsToLayer(['Outline'], target);

    expect(objectById('Outline').operationOverride).toEqual({ power: 55, byOperation: {} });
  });

  it('changes nothing and records no undo step when the artwork is already there', () => {
    useStore.getState().selectObject('Outline');

    useStore.getState().assignSelectionToLayer(onlyOperationOf('Outline'));

    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('drops artwork moved onto a hidden operation from the selection', () => {
    const target = onlyOperationOf('Engraving');
    useStore.getState().setLayerParam(target, { visible: false });
    useStore.setState({ undoStack: [] });
    useStore.getState().selectObject('Outline');

    useStore.getState().assignSelectionToLayer(target);

    expect(operationsOf('Outline')).toEqual([target]);
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('moves the named artwork, not the canvas selection', () => {
    const target = onlyOperationOf('Engraving');
    useStore.getState().selectObject('Engraving');

    useStore.getState().assignObjectsToLayer(['Outline'], target);

    expect(operationsOf('Outline')).toEqual([target]);
    expect(useStore.getState().selectedObjectId).toBe('Engraving');
  });
});

describe('assignObjectsToOperation', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().importSvgObject(svgObj('Engraving', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('Outline', ['#0000ff']));
  });

  it('leaves locked artwork where it is', () => {
    patchObject('Outline', { locked: true });
    const scene = useStore.getState().project.scene;

    expect(
      assignObjectsToOperation(scene, new Set(['Outline']), onlyOperationOf('Engraving')),
    ).toBe(scene);
  });

  it('never moves artwork onto the registration jig operation', () => {
    const { project } = useStore.getState();
    const jig = createRegistrationLayer();
    const scene = { ...project.scene, layers: [...project.scene.layers, jig] };

    expect(assignObjectsToOperation(scene, new Set(['Outline']), jig.id)).toBe(scene);
  });

  it('binds artwork that ran on two operations to the target alone', () => {
    const engraving = onlyOperationOf('Engraving');
    const outline = onlyOperationOf('Outline');
    useStore.getState().importSvgObject(svgObj('Both', ['#ff0000', '#0000ff']));
    expect(operationsOf('Both')).toHaveLength(2);
    const scene = useStore.getState().project.scene;

    const next = assignObjectsToOperation(scene, new Set(['Both']), outline);
    const moved = next.objects.find((object) => object.id === 'Both');

    expect(moved === undefined ? [] : operationIdsForObject(moved, next.layers)).toEqual([outline]);
    // Both operations it left are now empty and go; the others keep their artwork.
    expect(next.layers.map((layer) => layer.id)).toEqual([engraving, outline]);
  });
});
