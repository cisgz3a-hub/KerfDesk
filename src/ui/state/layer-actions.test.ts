import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type RasterImage,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

function rasterObj(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 10,
    lumaBase64: 'gA==',
  };
}

describe('layer store actions', () => {
  beforeEach(() => {
    resetStore();
  });

  it('createManualLayer adds an empty layer and is undoable', () => {
    useStore.setState({ dirty: false });

    useStore.getState().createManualLayer('#00FF00');

    expect(useStore.getState().project.scene.layers.map((layer) => layer.color)).toEqual([
      '#00ff00',
    ]);
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(useStore.getState().project.scene.layers).toHaveLength(0);
  });

  it('commitLayerDraft creates a configured empty output in one undo step', () => {
    const draft = { ...createLayer({ id: '#00ff00', color: '#00ff00' }), power: 55, passes: 2 };

    useStore.getState().commitLayerDraft(draft);

    expect(useStore.getState().project.scene.layers).toEqual([draft]);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.layers).toHaveLength(0);
  });

  it('commitLayerDraft updates operation settings and presentation color without recoloring artwork', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const current = useStore.getState().project.scene.layers[0];
    if (current === undefined) throw new Error('layer missing');
    const undoBefore = useStore.getState().undoStack.length;

    useStore.getState().commitLayerDraft({
      ...current,
      color: '#00ff00',
      mode: 'fill',
      power: 64,
    });

    const state = useStore.getState();
    expect(state.project.scene.layers[0]).toMatchObject({
      id: current.id,
      color: '#00ff00',
      mode: 'fill',
      power: 64,
    });
    const object = state.project.scene.objects[0];
    expect(object?.kind).toBe('imported-svg');
    if (object?.kind !== 'imported-svg') throw new Error('expected imported svg');
    expect(object.paths[0]?.color).toBe('#ff0000');
    expect(state.undoStack).toHaveLength(undoBefore + 1);
  });

  it('setLayerColor changes only the automatic operation color and is undoable', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff']));
    const undoBefore = useStore.getState().undoStack.length;
    const beforeColors = useStore.getState().project.scene.layers.map((layer) => layer.color);
    const [firstOperationId] = operationIdsFor('O1');
    if (firstOperationId === undefined) throw new Error('operation missing');

    useStore.getState().setLayerColor(firstOperationId, '#00FF00');

    const state = useStore.getState();
    expect(state.project.scene.layers.map((layer) => layer.color)).toEqual([
      '#00ff00',
      beforeColors[1],
    ]);
    const object = state.project.scene.objects[0];
    expect(object?.kind).toBe('imported-svg');
    if (object?.kind !== 'imported-svg') throw new Error('expected imported svg');
    expect(object.paths.map((path) => path.color)).toEqual(['#ff0000', '#0000ff']);
    expect(state.undoStack).toHaveLength(undoBefore + 1);

    useStore.getState().undo();
    expect(useStore.getState().project.scene.layers.map((layer) => layer.color)).toEqual(
      beforeColors,
    );
  });

  it('assignSelectionToLayer moves selected object colors and prunes orphan layers', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().createManualLayer('#00ff00');
    useStore.getState().selectObject('O1');

    useStore.getState().assignSelectionToLayer('#00ff00');

    const obj = useStore.getState().project.scene.objects[0];
    expect(obj?.kind).toBe('imported-svg');
    if (obj?.kind !== 'imported-svg') throw new Error('expected imported svg');
    expect(obj.paths.map((path) => path.color)).toEqual(['#ff0000']);
    expect(useStore.getState().project.scene.layers.map((layer) => layer.color)).toEqual([
      '#00ff00',
    ]);
  });

  it('assignSelectionToLayer keeps unrelated empty manual layers', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().createManualLayer('#00ff00');
    useStore.getState().createManualLayer('#0000ff');
    useStore.getState().selectObject('O1');

    useStore.getState().assignSelectionToLayer('#00ff00');

    expect(useStore.getState().project.scene.layers.map((layer) => layer.color)).toEqual([
      '#00ff00',
      '#0000ff',
    ]);
  });

  it('selectObjectsOnLayer selects artwork intentionally sharing one operation', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const [sharedOperationId] = operationIdsFor('O1');
    if (sharedOperationId === undefined) throw new Error('operation missing');
    useStore.getState().importSvgObject(svgObj('O2', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O3', ['#0000ff']));
    useStore.setState({ selectedObjectId: 'O1', additionalSelectedIds: new Set(['O2']) });
    useStore.getState().useOperationForSelection(sharedOperationId);
    useStore.setState({
      dirty: false,
      selectedObjectId: 'O3',
      additionalSelectedIds: new Set(['missing']),
    });
    const undoBefore = useStore.getState().undoStack.length;

    useStore.getState().selectObjectsOnLayer(sharedOperationId);

    const state = useStore.getState();
    expect(state.selectedObjectId).toBe('O1');
    expect([...state.additionalSelectedIds]).toEqual(['O2']);
    expect(state.dirty).toBe(false);
    expect(state.undoStack).toHaveLength(undoBefore);
  });

  it('selectObjectsOnLayer selects raster objects by raster color', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importRasterImage(rasterObj('R1'));
    const [rasterOperationId] = operationIdsFor('R1');
    if (rasterOperationId === undefined) throw new Error('raster operation missing');

    useStore.getState().selectObjectsOnLayer(rasterOperationId);

    const state = useStore.getState();
    expect(state.selectedObjectId).toBe('R1');
    expect(state.additionalSelectedIds.size).toBe(0);
  });

  it('selectObjectsOnLayer clears selection when no object uses the layer', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.setState({ selectedObjectId: 'O1' });

    useStore.getState().selectObjectsOnLayer('#00ff00');

    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
  });

  it('hiding a layer prunes hidden objects from the current selection', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0000ff']));
    useStore.setState({
      selectedObjectId: 'O1',
      additionalSelectedIds: new Set(['O2']),
      dirty: false,
    });
    const [operationId] = operationIdsFor('O1');
    if (operationId === undefined) throw new Error('operation missing');

    useStore.getState().setLayerParam(operationId, { visible: false });

    const state = useStore.getState();
    expect(state.selectedObjectId).toBe('O2');
    expect(state.additionalSelectedIds.size).toBe(0);
  });

  it('deleteLayerAndObjects removes only artwork bound to that explicit operation', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#ff0000', '#0000ff']));
    useStore.getState().importSvgObject(svgObj('O3', ['#00ff00']));
    const undoBefore = useStore.getState().undoStack.length;
    useStore.setState({
      selectedObjectId: 'O1',
      additionalSelectedIds: new Set(['O2', 'O3']),
      dirty: false,
    });
    const [operationId] = operationIdsFor('O1');
    if (operationId === undefined) throw new Error('operation missing');

    useStore.getState().deleteLayerAndObjects(operationId);

    const state = useStore.getState();
    expect(state.project.scene.objects.map((object) => object.id)).toEqual(['O2', 'O3']);
    const kept = state.project.scene.objects[0];
    expect(kept?.kind).toBe('imported-svg');
    if (kept?.kind !== 'imported-svg') throw new Error('expected imported svg');
    expect(kept.paths.map((path) => path.color)).toEqual(['#ff0000', '#0000ff']);
    expect(operationIdsFor('O2')).toHaveLength(2);
    expect(operationIdsFor('O3')).toHaveLength(1);
    expect(state.selectedObjectId).toBeNull();
    expect([...state.additionalSelectedIds]).toEqual(['O2', 'O3']);
    expect(state.undoStack).toHaveLength(undoBefore + 1);
    expect(state.dirty).toBe(true);

    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'O1',
      'O2',
      'O3',
    ]);
  });

  it('deleteLayerAndObjects removes raster objects assigned to the layer color', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importRasterImage(rasterObj('R1'));
    const [rasterOperationId] = operationIdsFor('R1');
    if (rasterOperationId === undefined) throw new Error('raster operation missing');

    useStore.getState().deleteLayerAndObjects(rasterOperationId);

    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(['O1']);
    expect(useStore.getState().project.scene.layers).toHaveLength(1);
  });

  it('deleteLayerAndObjects removes an empty manual layer', () => {
    useStore.getState().createManualLayer('#00ff00');
    const undoBefore = useStore.getState().undoStack.length;
    useStore.setState({ dirty: false });

    useStore.getState().deleteLayerAndObjects('#00ff00');

    expect(useStore.getState().project.scene.layers).toHaveLength(0);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().undoStack).toHaveLength(undoBefore + 1);
    expect(useStore.getState().dirty).toBe(true);
  });

  it('adds, updates, deletes, and undoes layer sub-layers', () => {
    useStore.getState().createManualLayer('#ff0000');
    useStore.getState().setLayerParam('#ff0000', { mode: 'fill', power: 22, speed: 3333 });
    useStore.setState({ dirty: false, undoStack: [] });

    useStore.getState().addLayerSubLayer('#ff0000');

    let layer = useStore.getState().project.scene.layers[0];
    const subLayer = layer?.subLayers[0];
    expect(subLayer).toMatchObject({
      id: 'sub-1',
      label: 'Sub-layer 1',
      enabled: true,
      settings: { mode: 'fill', power: 22, speed: 3333 },
    });

    if (subLayer === undefined) throw new Error('expected sub-layer');
    useStore.getState().updateLayerSubLayer('#ff0000', subLayer.id, {
      mode: 'line',
      power: 80,
    });
    layer = useStore.getState().project.scene.layers[0];
    expect(layer?.subLayers[0]).toMatchObject({
      settings: { mode: 'line', power: 80, speed: 3333 },
    });

    useStore.getState().deleteLayerSubLayer('#ff0000', subLayer.id);
    expect(useStore.getState().project.scene.layers[0]?.subLayers).toEqual([]);

    useStore.getState().undo();
    expect(useStore.getState().project.scene.layers[0]?.subLayers[0]).toMatchObject({
      id: 'sub-1',
      settings: { mode: 'line', power: 80 },
    });
  });

  it('makeLayerDefault remembers current settings without mutating project history', () => {
    useStore.getState().createManualLayer('#ff0000');
    useStore.getState().setLayerParam('#ff0000', { mode: 'fill', power: 22, speed: 3333 });
    useStore.setState({ dirty: false, undoStack: [] });

    useStore.getState().makeLayerDefault('#ff0000');

    expect(useStore.getState().layerDefaults.byColor['#ff0000']).toMatchObject({
      mode: 'fill',
      power: 22,
      speed: 3333,
    });
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('resetLayerToDefault applies the saved color default through one undoable patch', () => {
    useStore.getState().createManualLayer('#ff0000');
    useStore.getState().setLayerParam('#ff0000', { mode: 'fill', power: 22 });
    useStore.getState().makeLayerDefault('#ff0000');
    useStore.getState().setLayerParam('#ff0000', { mode: 'line', power: 80 });
    useStore.setState({ dirty: false, undoStack: [] });

    useStore.getState().resetLayerToDefault('#ff0000');

    expect(useStore.getState().project.scene.layers[0]).toMatchObject({
      mode: 'fill',
      power: 22,
    });
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('createManualLayer applies the saved color default to a later matching layer', () => {
    useStore.getState().createManualLayer('#ff0000');
    useStore.getState().setLayerParam('#ff0000', { mode: 'fill', power: 22 });
    useStore.getState().makeLayerDefault('#ff0000');
    useStore.getState().deleteLayerAndObjects('#ff0000');

    useStore.getState().createManualLayer('#ff0000');

    expect(useStore.getState().project.scene.layers[0]).toMatchObject({
      id: '#ff0000',
      color: '#ff0000',
      mode: 'fill',
      power: 22,
    });
  });

  it('import-created layers apply the saved color default', () => {
    useStore.getState().createManualLayer('#ff0000');
    useStore.getState().setLayerParam('#ff0000', { mode: 'fill', power: 22 });
    useStore.getState().makeLayerDefault('#ff0000');
    useStore.getState().deleteLayerAndObjects('#ff0000');

    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));

    expect(useStore.getState().project.scene.layers[0]).toMatchObject({
      id: 'operation-O1',
      color: '#2563eb',
      mode: 'fill',
      power: 22,
    });
  });

  it('makeLayerDefaultForAll applies the saved default to later colors', () => {
    useStore.getState().createManualLayer('#ff0000');
    useStore.getState().setLayerParam('#ff0000', { mode: 'fill', power: 35, speed: 2444 });
    useStore.getState().makeLayerDefaultForAll('#ff0000');

    useStore.getState().createManualLayer('#00ff00');

    expect(useStore.getState().project.scene.layers[1]).toMatchObject({
      id: '#00ff00',
      color: '#00ff00',
      mode: 'fill',
      power: 35,
      speed: 2444,
    });
  });
});

function operationIdsFor(objectId: string): ReadonlyArray<string> {
  const { objects, layers } = useStore.getState().project.scene;
  const object = objects.find((candidate) => candidate.id === objectId);
  return object === undefined ? [] : operationIdsForObject(object, layers);
}
