import { beforeEach, describe, expect, it } from 'vitest';
import type { ObjectOperationOverride } from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

beforeEach(() => {
  resetStore();
});

function layerIds(): ReadonlyArray<string> {
  return useStore.getState().project.scene.layers.map((layer) => layer.id);
}

function layer(id: string) {
  return useStore.getState().project.scene.layers.find((candidate) => candidate.id === id);
}

describe('ADR-385 Line options in store actions', () => {
  it('keeps valid Line options on an artwork override, including an explicit 0 overcut', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().selectObject('O1');
    const patch = {
      overcutMm: 0,
      tabPlacement: 'spacing',
      tabSpacingMm: 0.5,
      tabMinPerShape: 2.5,
      tabMaxPerShape: 7,
    } as ObjectOperationOverride;

    useStore.getState().setSelectedObjectsOperationOverride(patch);

    expect(useStore.getState().project.scene.objects[0]?.operationOverride).toEqual({
      overcutMm: 0,
      tabPlacement: 'spacing',
      tabSpacingMm: 1,
      tabMinPerShape: 2,
      tabMaxPerShape: 7,
    });
  });

  it('drops an unknown tab placement', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().selectObject('O1');

    useStore.getState().setSelectedObjectsOperationOverride({
      tabPlacement: 'random',
    } as unknown as ObjectOperationOverride);

    expect(useStore.getState().project.scene.objects[0]?.operationOverride).toBeUndefined();
  });

  it('copies Line options with operation settings, and pasting clears ones the source lacks', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#00ff00']));
    const [sourceId, targetId] = layerIds();
    if (sourceId === undefined || targetId === undefined) throw new Error('layers missing');
    useStore.getState().setLayerParam(targetId, { overcutMm: 3, tabPlacement: 'spacing' });

    useStore.getState().copyLayerSettings(sourceId);
    useStore.getState().pasteLayerSettings(targetId);
    expect(layer(targetId)?.overcutMm).toBeUndefined();
    expect(layer(targetId)?.tabPlacement).toBeUndefined();

    useStore.getState().setLayerParam(sourceId, { overcutMm: 1.5, tabSpacingMm: 20 });
    useStore.getState().copyLayerSettings(sourceId);
    useStore.getState().pasteLayerSettings(targetId);
    expect(layer(targetId)).toMatchObject({ overcutMm: 1.5, tabSpacingMm: 20 });
  });
});
