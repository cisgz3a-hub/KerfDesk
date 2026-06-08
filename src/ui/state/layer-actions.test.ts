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
});
