import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS, operationIdsForObject } from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

describe('operation settings clipboard', () => {
  beforeEach(() => resetStore());

  it('copies settings without dirty or undo changes', () => {
    arrangeTwoOperations();
    const [sourceId] = operationIdsFor('O1');
    if (sourceId === undefined) throw new Error('source operation missing');
    configureSource(sourceId);
    useStore.setState({ dirty: false, undoStack: [] });

    useStore.getState().copyLayerSettings(sourceId);

    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('pastes laser and CNC settings while preserving the target identity', () => {
    arrangeTwoOperations();
    const [sourceId, targetId] = operationIdsFor('O1');
    if (sourceId === undefined || targetId === undefined) throw new Error('operations missing');
    configureSource(sourceId);
    useStore.getState().copyLayerSettings(sourceId);
    useStore.setState({ dirty: false, undoStack: [] });
    const targetBefore = operation(targetId);

    useStore.getState().pasteLayerSettings(targetId);

    expect(operation(targetId)).toMatchObject({
      id: targetId,
      color: targetBefore?.color,
      name: targetBefore?.name,
      mode: 'fill',
      minPower: 12,
      power: 66,
      speed: 2222,
      passes: 3,
      output: false,
      hatchAngleDeg: 45,
      fillBidirectional: false,
      fillCrossHatch: true,
      cnc: { cutType: 'pocket', depthMm: 4, feedMmPerMin: 777 },
    });
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().dirty).toBe(true);
  });

  it('does nothing when no settings were copied', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const [operationId] = operationIdsFor('O1');
    if (operationId === undefined) throw new Error('operation missing');
    const before = useStore.getState().project;
    useStore.setState({ dirty: false, undoStack: [] });

    useStore.getState().pasteLayerSettings(operationId);

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
  });
});

function arrangeTwoOperations(): void {
  useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff']));
}

function configureSource(operationId: string): void {
  useStore.getState().setLayerParam(operationId, {
    mode: 'fill',
    minPower: 12,
    power: 66,
    speed: 2222,
    passes: 3,
    output: false,
    hatchAngleDeg: 45,
    fillBidirectional: false,
    fillCrossHatch: true,
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket',
      depthMm: 4,
      feedMmPerMin: 777,
    },
  });
}

function operation(operationId: string) {
  return useStore.getState().project.scene.layers.find((layer) => layer.id === operationId);
}

function operationIdsFor(objectId: string): ReadonlyArray<string> {
  const { objects, layers } = useStore.getState().project.scene;
  const object = objects.find((candidate) => candidate.id === objectId);
  return object === undefined ? [] : operationIdsForObject(object, layers);
}
