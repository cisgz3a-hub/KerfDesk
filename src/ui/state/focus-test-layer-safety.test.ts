import { beforeEach, describe, expect, it } from 'vitest';
import { generateFocusTest } from '../../core/job/focus-test';
import { createProject, operationIdsForObject, type Scene } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const FOCUS = generateFocusTest({
  steps: 3,
  minOffsetMm: -1,
  maxOffsetMm: 1,
  lineLengthMm: 20,
  spacingMm: 3,
  speed: 1200,
  power: 10,
  travelFeedMmPerMin: 300,
});

function openScene(scene: Scene): void {
  const project = createProject();
  useStore.getState().setProject({ ...project, scene });
}

function copySample(index: number): string {
  const object = useStore.getState().project.scene.objects[index];
  if (object === undefined) throw new Error('sample missing');
  useStore.getState().selectObject(object.id);
  useStore.getState().copySelection();
  return object.id;
}

function pastedOperation() {
  const state = useStore.getState();
  const scene = state.project.scene;
  const pasted = scene.objects.find((object) => object.id === state.selectedObjectId);
  if (pasted === undefined) throw new Error('nothing pasted');
  const [id] = operationIdsForObject(pasted, scene.layers);
  return scene.layers.find((layer) => layer.id === id);
}

describe('Focus Test Z intent on operations', () => {
  beforeEach(() => resetStore());

  it('pastes a Focus sample into another project as an ordinary operation', () => {
    openScene(FOCUS);
    copySample(2);
    openScene(createProject().scene);
    useStore.getState().pasteClipboard();
    const operation = pastedOperation();
    expect(operation).toBeDefined();
    expect(operation?.focusTest).toBeUndefined();
    expect(operation?.speed).toBe(1200);
  });

  it('keeps the sample operation for a paste within the same project', () => {
    openScene(FOCUS);
    copySample(2);
    useStore.getState().pasteClipboard();
    expect(pastedOperation()?.focusTest).toEqual({ offsetMm: 1, travelFeedMmPerMin: 300 });
  });

  it('removes Focus Test Z from one operation as an undoable step', () => {
    openScene(FOCUS);
    const [first, second] = FOCUS.layers;
    if (first === undefined || second === undefined) throw new Error('samples missing');
    useStore.getState().removeLayerFocusTest(first.id);
    const layers = useStore.getState().project.scene.layers;
    expect(layers[0]?.focusTest).toBeUndefined();
    expect(layers[0] !== undefined && 'focusTest' in layers[0]).toBe(false);
    expect(layers[1]?.focusTest).toEqual(second.focusTest);
    expect(useStore.getState().dirty).toBe(true);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.layers[0]?.focusTest).toEqual(first.focusTest);
  });
});
