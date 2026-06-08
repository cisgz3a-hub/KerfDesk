import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
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

  it('assignSelectionToLayer moves selected object colors and prunes orphan layers', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().createManualLayer('#00ff00');
    useStore.getState().selectObject('O1');

    useStore.getState().assignSelectionToLayer('#00ff00');

    const obj = useStore.getState().project.scene.objects[0];
    expect(obj?.kind).toBe('imported-svg');
    if (obj?.kind !== 'imported-svg') throw new Error('expected imported svg');
    expect(obj.paths.map((path) => path.color)).toEqual(['#00ff00']);
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

  it('selectObjectsOnLayer selects every vector object using that layer color', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0000ff', '#ff0000']));
    useStore.getState().importSvgObject(svgObj('O3', ['#0000ff']));
    useStore.setState({
      dirty: false,
      selectedObjectId: 'O3',
      additionalSelectedIds: new Set(['missing']),
    });

    useStore.getState().selectObjectsOnLayer('#ff0000');

    const state = useStore.getState();
    expect(state.selectedObjectId).toBe('O1');
    expect([...state.additionalSelectedIds]).toEqual(['O2']);
    expect(state.dirty).toBe(false);
    expect(state.undoStack).toHaveLength(3);
  });

  it('selectObjectsOnLayer selects raster objects by raster color', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importRasterImage(rasterObj('R1'));

    useStore.getState().selectObjectsOnLayer('#808080');

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

  it('deleteLayerAndObjects removes matching vector paths and preserves unrelated paths', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#ff0000', '#0000ff']));
    useStore.getState().importSvgObject(svgObj('O3', ['#00ff00']));
    const undoBefore = useStore.getState().undoStack.length;
    useStore.setState({
      selectedObjectId: 'O1',
      additionalSelectedIds: new Set(['O2', 'O3']),
      dirty: false,
    });

    useStore.getState().deleteLayerAndObjects('#ff0000');

    const state = useStore.getState();
    expect(state.project.scene.objects.map((object) => object.id)).toEqual(['O2', 'O3']);
    const kept = state.project.scene.objects[0];
    expect(kept?.kind).toBe('imported-svg');
    if (kept?.kind !== 'imported-svg') throw new Error('expected imported svg');
    expect(kept.paths.map((path) => path.color)).toEqual(['#0000ff']);
    expect(state.project.scene.layers.map((layer) => layer.color)).toEqual(['#0000ff', '#00ff00']);
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

    useStore.getState().deleteLayerAndObjects('#808080');

    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(['O1']);
    expect(useStore.getState().project.scene.layers.map((layer) => layer.color)).toEqual([
      '#ff0000',
    ]);
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

  it('copyLayerSettings captures settings without dirty or undo changes', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff']));
    useStore.getState().setLayerParam('#ff0000', {
      mode: 'fill',
      minPower: 12,
      power: 66,
      speed: 2222,
      passes: 3,
      output: false,
      hatchAngleDeg: 45,
      fillBidirectional: false,
    });
    useStore.setState({ dirty: false, undoStack: [] });

    useStore.getState().copyLayerSettings('#ff0000');

    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('pasteLayerSettings applies copied settings while preserving target id and color', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff']));
    useStore.getState().setLayerParam('#ff0000', {
      mode: 'fill',
      minPower: 12,
      power: 66,
      speed: 2222,
      passes: 3,
      output: false,
      hatchAngleDeg: 45,
      fillBidirectional: false,
    });
    useStore.getState().copyLayerSettings('#ff0000');
    useStore.setState({ dirty: false, undoStack: [] });

    useStore.getState().pasteLayerSettings('#0000ff');

    const pasted = useStore.getState().project.scene.layers.find((layer) => layer.id === '#0000ff');
    expect(pasted).toMatchObject({
      id: '#0000ff',
      color: '#0000ff',
      mode: 'fill',
      minPower: 12,
      power: 66,
      speed: 2222,
      passes: 3,
      output: false,
      hatchAngleDeg: 45,
      fillBidirectional: false,
    });
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().dirty).toBe(true);
  });

  it('pasteLayerSettings without copied settings is a no-op', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const before = useStore.getState().project;
    useStore.setState({ dirty: false, undoStack: [] });

    useStore.getState().pasteLayerSettings('#ff0000');

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
  });
});
